// Resolution model calls: grounded search (URLs only), the judge (one page), the arbiter (contradictions).
// Model outputs are inputs to code gates, never the verdict itself (constitution II).
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Contract } from '../contract/schema.js';
import { quoteInText } from '../resolve/similarity.js';
import type { CallCost, LlmClient } from './client.js';
import { loadInstruction } from './instructions.js';

export const SEARCH_VERSION = 'search.v2';
export const JUDGE_VERSION = 'judge.v3';
// The seeded claims were recorded with v2 (no event_start); they replay with it — no paid re-record.
export const SEEDS_JUDGE_VERSION = 'judge.v2';
export const ARBITRATE_VERSION = 'arbitrate.v1';

type Window = { lockAt: Date; deadlineAt: Date };

const contractInput = (contract: Contract, window: Window) => ({
  contract,
  lock: window.lockAt.toISOString(),
  deadline: window.deadlineAt.toISOString(),
});

export async function searchSources(llm: LlmClient, model: string, contract: Contract, window: Window, pass: number, knownSources: readonly string[]) {
  // pass is part of the input so two passes are two recorded calls, even with the same model.
  return llm.groundedSearch({
    model,
    instructionVersion: SEARCH_VERSION,
    system: loadInstruction(SEARCH_VERSION),
    input: JSON.stringify({ ...contractInput(contract, window), pass, known_sources: knownSources }),
  });
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const JudgeFields = {
  says: z.enum(['hit', 'miss', 'pending', 'irrelevant', 'entity_gone']),
  basis: z.enum(['record', 'absence']),
  event_date: DATE.nullable(),
  event_start: z.string().max(40).nullable().optional(), // v3; absent in v2 answers; unparseable = no time (gates.ts)
  result: z.string().max(80).nullable().optional(), // v3: the outcome in its own words, shown in the verdict reply
  is_final_result: z.boolean(),
  from_contract_source: z.boolean(),
  source_trust: z.enum(['primary', 'established', 'weak']),
  trust_reason: z.string().max(200),
  original_source: z.string().max(80).nullable(),
  reasoning: z.string().max(400),
};
const JudgeSchema = z.object({ ...JudgeFields, quote: z.string().max(600).nullable() });
// Recorded shape: no quote field at all (the replay store refuses one), only its hash and whether it was on the page.
const JudgeRecordedSchema = z.object({ ...JudgeFields, quote_sha256: z.string().nullable(), quote_found: z.boolean() });

export type Judgement = Omit<z.infer<typeof JudgeSchema>, 'quote'> & { quoteFound: boolean | null };

// v3 also gets when the claim was last set (lock − 15 min): a match that began after it counts (gates.ts).
function judgeInput(contract: Contract, window: Window, version: string) {
  if (version === 'judge.v2') return contractInput(contract, window);
  return { ...contractInput(contract, window), claim_set: new Date(window.lockAt.getTime() - 15 * 60 * 1000).toISOString() };
}

export async function judgePage(
  llm: LlmClient,
  model: string,
  contract: Contract,
  window: Window,
  page: { url: string; text: string; sha256: string },
  version: string = JUDGE_VERSION,
): Promise<{ judgement: Judgement; costs: CallCost[] }> {
  const { data, costs } = await llm.generateJson<z.infer<typeof JudgeSchema> & { quote_found?: boolean }>({
    model,
    instructionVersion: version,
    operation: 'judge',
    system: loadInstruction(version),
    input: JSON.stringify({ ...judgeInput(contract, window, version), page: { url: page.url, text: page.text } }),
    replayIdentity: { ...judgeInput(contract, window, version), url: page.url, sha256: page.sha256 },
    schema: JudgeSchema,
    replaySchema: JudgeRecordedSchema as unknown as z.ZodType<z.infer<typeof JudgeSchema> & { quote_found?: boolean }>,
    recordAs: (raw) => redactQuote(raw, page.text),
  });
  // Live: check the quote against the page now. Replay: use the check made when it was recorded.
  const quoteFound = data.quote_found ?? (data.quote ? quoteInText(data.quote, page.text) : null);
  const judgement: Judgement = {
    says: data.says, basis: data.basis, event_date: data.event_date, event_start: data.event_start ?? null, result: data.result ?? null, is_final_result: data.is_final_result,
    from_contract_source: data.from_contract_source, source_trust: data.source_trust, trust_reason: data.trust_reason,
    original_source: data.original_source, reasoning: data.reasoning, quoteFound,
  };
  return { judgement, costs }; // the quote goes no further than this function
}

function redactQuote(raw: unknown, text: string): unknown {
  if (raw === null || typeof raw !== 'object' || !('quote' in raw)) return raw;
  const { quote, ...rest } = raw as { quote: unknown };
  const q = typeof quote === 'string' ? quote : null;
  return { ...rest, quote_sha256: q ? createHash('sha256').update(q).digest('hex') : null, quote_found: q ? quoteInText(q, text) : false };
}

const ArbiterSchema = z.object({
  decision: z.enum(['decided', 'cannot_decide']),
  deciding_index: z.number().int().min(0).nullable(),
  outcome: z.enum(['hit', 'miss']).nullable(),
  notes: z.string().max(400),
});
export type ArbiterAnswer = z.infer<typeof ArbiterSchema>;

export type ArbiterItem = { sourceName: string; trustLevel: string; says: string; eventDate: string | null; url: string; sha256: string; text: string };

export async function arbitrate(llm: LlmClient, model: string, contract: Contract, window: Window, items: ArbiterItem[]) {
  const { data, costs } = await llm.generateJson({
    model,
    instructionVersion: ARBITRATE_VERSION,
    operation: 'arbitrate',
    system: loadInstruction(ARBITRATE_VERSION),
    input: JSON.stringify({
      ...contractInput(contract, window),
      items: items.map((item, index) => ({ index, source: item.sourceName, trust: item.trustLevel, says: item.says, event_date: item.eventDate, url: item.url, text: item.text })),
    }),
    replayIdentity: { ...contractInput(contract, window), items: items.map((item) => ({ url: item.url, sha256: item.sha256, says: item.says })) },
    schema: ArbiterSchema,
  });
  // The arbiter may only side with one of the given items, with that item's own answer.
  const chosen = data.deciding_index === null ? undefined : items[data.deciding_index];
  const valid = data.decision === 'decided' && chosen !== undefined && data.outcome === chosen.says;
  return { answer: valid ? data : { ...data, decision: 'cannot_decide' as const, deciding_index: null, outcome: null }, costs };
}
