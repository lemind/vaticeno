// Gemini wrapper: JSON output validated by Zod, optional Google Search grounding, LLM_MODE live|record|replay.
// Returns each call's cost; callers record it (buffered until the claim exists — data-model "Cost rows").
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Cost } from '../db/costs.js';
import { log } from '../log.js';
import { SEARCH_QUERY_USD, modelCostUsd } from './prices.js';
import type { ReplayStore } from './replay.js';

export type LlmMode = 'live' | 'record' | 'replay';
export type CallCost = Omit<Cost, 'claimId'>;

export class LlmUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmUnavailable';
  }
}

export class LlmSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmSchemaError';
  }
}

type Usage = { input_tokens: number; output_tokens: number };

export type JsonCall<T> = {
  model: string;
  instructionVersion: string; // e.g. normalize.v1 — part of the replay key
  operation: CallCost['operation'];
  system: string;
  input: string;
  schema: z.ZodType<T>;
};

export type SearchResult = { queries: string[]; urls: string[] };

const TIMEOUT_MS = 60_000;

export function createLlmClient(options: { mode: LlmMode; apiKey?: string; store: ReplayStore }) {
  const { mode, store } = options;
  let ai: GoogleGenAI | undefined;
  const live = () => {
    if (!options.apiKey) throw new LlmUnavailable(`GEMINI_API_KEY is required for LLM_MODE=${mode}`);
    ai ??= new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { timeout: TIMEOUT_MS } });
    return ai;
  };

  async function generateJson<T>(call: JsonCall<T>): Promise<{ data: T; costs: CallCost[] }> {
    const identity = { model: call.model, instruction: call.instructionVersion, input: call.input };

    if (mode === 'replay') {
      const entry = await store.get('model', identity);
      if (entry.kind !== 'model') throw new LlmSchemaError('replay entry is not a model response');
      return { data: parseOutput(call.schema, entry.response), costs: [] };
    }

    let raw: unknown;
    let usage: Usage;
    try {
      const response = await live().models.generateContent({
        model: call.model,
        contents: call.input,
        config: {
          systemInstruction: call.system,
          responseMimeType: 'application/json',
          responseJsonSchema: z.toJSONSchema(call.schema, { io: 'input' }),
        },
      });
      usage = usageOf(response.usageMetadata);
      raw = JSON.parse(response.text ?? '');
    } catch (error) {
      if (error instanceof SyntaxError) throw new LlmSchemaError(`model returned invalid JSON: ${error.message}`);
      throw new LlmUnavailable(`model call failed: ${String(error)}`, { cause: error });
    }

    const data = parseOutput(call.schema, raw);
    if (mode === 'record') {
      await store.put('model', identity, {
        kind: 'model', model: call.model, instruction_version: call.instructionVersion, response: data, usage,
      });
    }
    return { data, costs: [modelCost(call.model, call.operation, usage)] };
  }

  // Grounded search: only the grounding metadata (queries + URLs) is used; the model's prose is ignored.
  async function groundedSearch(call: { model: string; instructionVersion: string; system: string; input: string }): Promise<SearchResult & { costs: CallCost[] }> {
    const identity = { model: call.model, instruction: call.instructionVersion, input: call.input };

    if (mode === 'replay') {
      const entry = await store.get('search', identity);
      if (entry.kind !== 'search') throw new LlmSchemaError('replay entry is not a search result');
      return { queries: entry.queries, urls: entry.urls, costs: [] };
    }

    let result: SearchResult;
    let usage: Usage;
    try {
      const response = await live().models.generateContent({
        model: call.model,
        contents: call.input,
        config: { systemInstruction: call.system, tools: [{ googleSearch: {} }] },
      });
      const grounding = response.candidates?.[0]?.groundingMetadata;
      const urls = (grounding?.groundingChunks ?? []).map((chunk) => chunk.web?.uri).filter((uri): uri is string => !!uri);
      result = { queries: grounding?.webSearchQueries ?? [], urls: [...new Set(urls)] };
      usage = usageOf(response.usageMetadata);
    } catch (error) {
      throw new LlmUnavailable(`search call failed: ${String(error)}`, { cause: error });
    }

    if (mode === 'record') {
      await store.put('search', identity, { kind: 'search', model: call.model, ...result, usage });
    }
    const costs: CallCost[] = [modelCost(call.model, 'search', usage)];
    if (result.queries.length > 0) {
      costs.push({ provider: 'google_search', operation: 'search', units: result.queries.length, usdCost: result.queries.length * SEARCH_QUERY_USD });
    }
    return { ...result, costs };
  }

  return { mode, generateJson, groundedSearch };
}

export type LlmClient = ReturnType<typeof createLlmClient>;

function parseOutput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new LlmSchemaError(`model output failed validation: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function usageOf(meta: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): Usage {
  return {
    input_tokens: meta?.promptTokenCount ?? 0,
    // Thinking tokens are billed as output.
    output_tokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
  };
}

function modelCost(model: string, operation: CallCost['operation'], usage: Usage): CallCost {
  const usd = modelCostUsd(model, usage.input_tokens, usage.output_tokens);
  if (usd === undefined) log('warn', 'no price for model; cost recorded as 0', { event: 'llm.price_unknown', model });
  return { provider: 'gemini', operation, units: 1, usdCost: usd ?? 0 };
}
