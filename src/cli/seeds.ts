// npm run seeds:crypto | seeds:open — resolve seeded historical claims whose correct verdict is known
// (SC-002 – SC-004, SC-010). Each seed gets a fresh claim in a scratch database; the resolver runs as of
// just after the deadline and then follows its own schedule (up to MAX_RUNS), as time would.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ContractSchema } from '../contract/schema.js';
import { newSlug } from '../contract/slug.js';
import { createScratchDb } from '../db/scratch.js';
import { claims, costEvents, evidences, resolutions } from '../db/schema.js';
import type { Candle, Coinbase } from '../feeds/coinbase.js';
import { createLlmClient } from '../llm/client.js';
import { createReplayStore } from '../llm/replay.js';
import { createPageFetcher } from '../resolve/fetch.js';
import { type ResolverDeps, resolveClaim } from '../resolve/resolver.js';
import { loadSourcePolicy } from '../resolve/trust.js';
import { cliArgs, printJson, runCli } from './run.js';

const SEEDS_DIR = fileURLToPath(new URL('../../fixtures/seeds', import.meta.url));
const MAX_RUNS = 4;
const HOUR_MS = 3_600_000;

// SC-003: the open-topic set must cover every failure mode at least this often.
export const OPEN_CATEGORY_MINIMUMS: Record<string, number> = {
  clear_hit: 8,
  clear_miss_final_result: 6,
  miss_by_meaningful_absence: 5,
  void_nothing_knowable: 5,
  event_before_lock: 4,
  event_after_deadline: 4,
  announcement_before_lock_event_after: 4,
  conflicting_reports: 4,
  copied_wire_stories: 4,
  source_page_changed: 4,
  partial_outcome: 4,
  ambiguous_entity: 4,
  technically_true_other_reading: 4,
};

const OUTCOMES = ['hit', 'miss', 'void', 'needs_human', 'pending'] as const;
type Outcome = (typeof OUTCOMES)[number];

const SeedSchema = z.object({
  id: z.string(),
  category: z.string(),
  contract: ContractSchema,
  lock_at: z.iso.datetime(),
  expected_outcome: z.enum(OUTCOMES),
  note: z.string(),
  candles: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])).optional(),
  product_status: z.string().optional(),
});
type Seed = z.infer<typeof SeedSchema>;

await runCli('seeds', async (config) => {
  const { positionals, values } = cliArgs({ category: { type: 'string' }, id: { type: 'string' }, verbose: { type: 'boolean' } });
  const set = z.enum(['crypto', 'open']).parse(positionals[0]);
  const seeds = (await loadSeeds(set)).filter((s) => (!values.category || s.category === values.category) && (!values.id || s.id === values.id));
  if (seeds.length === 0) throw new Error(`no ${set} seeds matched`);

  const scratch = await createScratchDb(config.DATABASE_URL, 'vaticeno_seeds');
  try {
    const store = createReplayStore();
    const llm = createLlmClient({ mode: config.LLM_MODE, apiKey: config.GEMINI_API_KEY, store });
    const base: Omit<ResolverDeps, 'coinbase'> = {
      db: scratch.db, llm, fetchPage: createPageFetcher({ mode: config.LLM_MODE, store }), policy: loadSourcePolicy(),
      judgeModelA: config.JUDGE_MODEL_A, judgeModelB: config.JUDGE_MODEL_B, arbiterModel: config.ARBITER_MODEL,
    };

    const results = [];
    for (const seed of seeds) {
      const deps = { ...base, coinbase: set === 'crypto' ? frozenCoinbase(seed) : unusedCoinbase() };
      const { actual, runs, usd, claimId } = await runSeed(deps, seed);
      const result = { seed_id: seed.id, category: seed.category, expected: seed.expected_outcome, actual, pass: actual === seed.expected_outcome, runs, usd_cost: Number(usd.toFixed(4)) };
      results.push(result);
      printJson(result);
      // SC-004: inspect what each verdict rests on (links, trust, answers, gates).
      if (values.verbose) {
        const rows = await scratch.db.select().from(evidences).where(eq(evidences.claimId, claimId)).orderBy(evidences.runAt);
        for (const e of rows) printJson({ seed_id: seed.id, run: e.runAt.toISOString(), source: e.sourceName, trust: e.trustLevel, says: e.says, event_date: e.eventDate, passed: e.passed, gates: e.gates, url: e.url });
      }
    }
    const summary = summarize(set, results);
    printJson(summary);
    if (!summary.ok) process.exitCode = 1;
  } finally {
    await scratch.close();
  }
});

async function runSeed(deps: ResolverDeps, seed: Seed): Promise<{ actual: Outcome; runs: number; usd: number; claimId: string }> {
  const deadline = new Date(seed.contract.deadline_at);
  const slug = await newSlug(async () => false);
  const [claim] = await deps.db.insert(claims).values({
    slug, sourceTweetId: `seed-${seed.id}-${slug}`, summonTweetId: `seed-${seed.id}`, sourceVersion: 'v1', authorXUserId: 'seed',
    status: 'draft', contract: seed.contract, resolutionMethod: seed.contract.resolution_method, deadlineAt: deadline,
    lockAt: new Date(seed.lock_at),
  }).returning();
  await deps.db.update(claims).set({ status: 'locked', nextCheckAt: deadline }).where(eq(claims.id, claim!.id));

  let now = new Date(deadline.getTime() + HOUR_MS);
  let runs = 0;
  while (runs < MAX_RUNS) {
    runs++;
    const [current] = await deps.db.select().from(claims).where(eq(claims.id, claim!.id));
    await resolveClaim(deps, current!, now);
    const [resolution] = await deps.db.select().from(resolutions).where(eq(resolutions.claimId, claim!.id));
    if (resolution) {
      const actual: Outcome = resolution.reviewStatus === 'needs_human' ? 'needs_human' : resolution.outcome!;
      return { actual, runs, usd: await spent(deps, claim!.id), claimId: claim!.id };
    }
    const [after] = await deps.db.select({ next: claims.nextCheckAt }).from(claims).where(eq(claims.id, claim!.id));
    now = after?.next ?? new Date(now.getTime() + 24 * HOUR_MS);
  }
  return { actual: 'pending', runs, usd: await spent(deps, claim!.id), claimId: claim!.id };
}

async function spent(deps: ResolverDeps, claimId: string): Promise<number> {
  const [row] = await deps.db.select({ usd: sql<string>`coalesce(sum(${costEvents.usdCost}), 0)` }).from(costEvents).where(eq(costEvents.claimId, claimId));
  return Number(row?.usd ?? 0);
}

type Result = { category: string; expected: Outcome; actual: Outcome; pass: boolean; usd_cost: number };

function summarize(set: 'crypto' | 'open', results: Result[]) {
  const agreed = results.filter((r) => r.pass).length;
  // SC-003: a wrong HIT/MISS is a decided verdict that differs; a VOID where the answer was knowable is
  // disagreement, not a wrong HIT/MISS.
  const wrong = results.filter((r) => !r.pass && (r.actual === 'hit' || r.actual === 'miss')).length;
  const byCategory: Record<string, { total: number; agreed: number }> = {};
  for (const r of results) {
    byCategory[r.category] ??= { total: 0, agreed: 0 };
    byCategory[r.category]!.total++;
    if (r.pass) byCategory[r.category]!.agreed++;
  }
  const short = set === 'open'
    ? Object.entries(OPEN_CATEGORY_MINIMUMS).filter(([cat, min]) => (byCategory[cat]?.total ?? 0) < min).map(([cat]) => cat)
    : [];
  const agreement = agreed / results.length;
  const wrongRate = wrong / results.length;
  const ok = set === 'crypto' ? agreed === results.length : agreement >= 0.95 && wrongRate < 0.05 && short.length === 0;
  return {
    set, total: results.length, agreed, agreement: Number(agreement.toFixed(3)), wrong_hit_miss: wrong, wrong_rate: Number(wrongRate.toFixed(3)),
    needs_human: results.filter((r) => r.actual === 'needs_human').length,
    usd_cost: Number(results.reduce((sum, r) => sum + r.usd_cost, 0).toFixed(4)),
    max_claim_usd: Math.max(...results.map((r) => r.usd_cost)),
    categories_below_minimum: short, by_category: byCategory, ok,
  };
}

// Crypto seeds carry frozen candles: results never drift and no network is touched.
function frozenCoinbase(seed: Seed): Coinbase {
  const candles: Candle[] = (seed.candles ?? []).map(([time, , , , close]) => ({ day: new Date(time * 1000).toISOString().slice(0, 10), close }));
  return {
    productStatus: async () => seed.product_status ?? 'online',
    productExists: async () => (seed.product_status ?? 'online') === 'online',
    dailyCandles: async (_id: string, fromDay: string, toDay: string) => candles.filter((c) => c.day >= fromDay && c.day <= toDay),
  };
}

function unusedCoinbase(): Coinbase {
  const fail = async (): Promise<never> => { throw new Error('open-topic seeds must not use the price feed'); };
  return { productStatus: fail, productExists: fail, dailyCandles: fail };
}

async function loadSeeds(set: string): Promise<Seed[]> {
  const dir = `${SEEDS_DIR}/${set}`;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const seeds: Seed[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(`${dir}/${file}`, 'utf8')) as unknown;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      const parsed = SeedSchema.safeParse(item);
      if (!parsed.success) throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);
      seeds.push(parsed.data);
    }
  }
  return seeds;
}
