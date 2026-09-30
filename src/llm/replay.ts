// Replay store: recorded external responses so corpus and seed runs repeat at zero cost (research R5).
// Test tooling only. Never holds content: page text and model quotes are refused (FR-029).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DEFAULT_DIR = fileURLToPath(new URL('../../fixtures/replay', import.meta.url));

export const REPLAY_KINDS = ['model', 'search', 'fetch', 'coinbase'] as const;
export type ReplayKind = (typeof REPLAY_KINDS)[number];

const ModelEntry = z.object({
  kind: z.literal('model'),
  model: z.string(),
  instruction_version: z.string(),
  response: z.unknown(), // parsed JSON output; quotes already replaced by quote_sha256 + quote_found
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});
const SearchEntry = z.object({
  kind: z.literal('search'),
  model: z.string(),
  queries: z.array(z.string()),
  urls: z.array(z.string()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});
const FetchEntry = z.object({
  kind: z.literal('fetch'),
  url: z.string(),
  sha256: z.string().nullable(),
  retrieved_at: z.string(),
  status: z.number(),
});
const CoinbaseEntry = z.object({ kind: z.literal('coinbase'), response: z.unknown() });

export const ReplayEntrySchema = z.discriminatedUnion('kind', [ModelEntry, SearchEntry, FetchEntry, CoinbaseEntry]);
export type ReplayEntry = z.infer<typeof ReplayEntrySchema>;

const FORBIDDEN_KEYS = new Set(['text', 'quote', 'body', 'html', 'content', 'page_text']);

export function replayKey(kind: ReplayKind, identity: unknown): string {
  return createHash('sha256').update(JSON.stringify({ kind, identity })).digest('hex');
}

export class ReplayMiss extends Error {
  constructor(kind: ReplayKind, key: string) {
    super(`no recorded ${kind} response for key ${key.slice(0, 12)}… (run with LLM_MODE=record)`);
    this.name = 'ReplayMiss';
  }
}

export function createReplayStore(dir: string = DEFAULT_DIR) {
  const pathFor = (kind: ReplayKind, key: string) => join(dir, kind, `${key}.json`);

  return {
    async get(kind: ReplayKind, identity: unknown): Promise<ReplayEntry> {
      const key = replayKey(kind, identity);
      let raw: string;
      try {
        raw = await readFile(pathFor(kind, key), 'utf8');
      } catch {
        throw new ReplayMiss(kind, key);
      }
      return ReplayEntrySchema.parse(JSON.parse(raw));
    },

    async put(kind: ReplayKind, identity: unknown, entry: ReplayEntry): Promise<void> {
      const parsed = ReplayEntrySchema.parse(entry);
      assertNoContent(parsed);
      const file = pathFor(kind, replayKey(kind, identity));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(parsed, null, 2) + '\n');
    },
  };
}

export type ReplayStore = ReturnType<typeof createReplayStore>;

// Refuses any field that could carry page text or a quote, at any depth.
export function assertNoContent(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoContent(item, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`replay entry must not contain content field ${path}.${key}`);
      assertNoContent(child, `${path}.${key}`);
    }
  }
}
