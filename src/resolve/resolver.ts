// Resolver service: due claims → evidence → rule table → one resolution per claim (data-model
// "resolutions", "Resolver schedule"). An outage is never a verdict (constitution III).
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { recordCosts } from '../db/costs.js';
import { claims, costEvents, evidences, resolutions } from '../db/schema.js';
import { type Coinbase, FeedUnavailable } from '../feeds/coinbase.js';
import { type CallCost, type LlmClient, LlmSchemaError, LlmUnavailable } from '../llm/client.js';
import { arbitrate } from '../llm/judges.js';
import { log } from '../log.js';
import { alert, captureError } from '../observe.js';
import { decideResolution, type Decision } from './decide.js';
import { type PageFetcher, SourceUnavailable } from './fetch.js';
import { runGates } from './gates.js';
import { gatherPriceEvidence } from './price-evidence.js';
import type { SourcePolicy } from './trust.js';
import { gatherWebEvidence, type GatheredItem } from './web-evidence.js';

export type ResolverDeps = {
  db: Db;
  llm: LlmClient;
  coinbase: Coinbase;
  fetchPage: PageFetcher;
  policy: SourcePolicy;
  judgeModelA: string;
  judgeModelB: string;
  arbiterModel: string;
};

export type ClaimRunOutcome = 'final' | 'needs_human' | 'waiting' | 'outage' | 'failed';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_CLAIMS_PER_RUN = 50;
const CLAIM_BUDGET_USD = 0.3;

let lastRunAt: Date | null = null;
export const lastResolverRunAt = () => lastRunAt; // for /healthz (one process)

export async function resolveDueClaims(deps: ResolverDeps, now: Date): Promise<Record<ClaimRunOutcome, number>> {
  const due = await deps.db.select().from(claims)
    .where(and(
      inArray(claims.status, ['locked', 'resolving']),
      lte(claims.nextCheckAt, now),
      sql`not exists (select 1 from ${resolutions} r where r.claim_id = ${claims.id})`,
    ))
    .orderBy(asc(claims.nextCheckAt))
    .limit(MAX_CLAIMS_PER_RUN);

  const summary: Record<ClaimRunOutcome, number> = { final: 0, needs_human: 0, waiting: 0, outage: 0, failed: 0 };
  for (const claim of due) {
    let outcome: ClaimRunOutcome;
    try {
      outcome = await resolveClaim(deps, claim, now);
    } catch (error) {
      // One broken claim never stops the others; it is retried on the next run.
      captureError(error, { event: 'resolver.claim_failed', claim_id: claim.id, slug: claim.slug });
      await deps.db.update(claims).set({ nextCheckAt: new Date(now.getTime() + HOUR_MS) }).where(eq(claims.id, claim.id));
      outcome = 'failed';
    }
    summary[outcome]++;
  }
  lastRunAt = now;
  log('info', 'resolver run', { event: 'resolver.run', due: due.length, ...summary });
  return summary;
}

type ClaimRow = typeof claims.$inferSelect;

export async function resolveClaim(deps: ResolverDeps, claim: ClaimRow, now: Date): Promise<ClaimRunOutcome> {
  const { db } = deps;
  if (!claim.lockAt || !claim.deadlineAt || now.getTime() <= claim.deadlineAt.getTime()) return 'waiting';
  const contract = ContractSchema.parse(claim.contract);
  const window = { lockAt: claim.lockAt, deadlineAt: claim.deadlineAt };
  if (claim.status === 'locked') {
    await db.update(claims).set({ status: 'resolving' }).where(and(eq(claims.id, claim.id), eq(claims.status, 'locked')));
  }

  const costs: CallCost[] = [];
  let items: GatheredItem[];
  try {
    if (contract.resolution_method === 'price_feed' && contract.price) {
      const { draft, value, contentSha256 } = await gatherPriceEvidence(deps.coinbase, contract.price, window, now);
      const { gates, passed } = runGates(draft, { ...window, absenceIsMeaningful: false }, []);
      items = [{ draft, gates, passed, value, sourceName: 'coinbase', contentSha256, searchQuery: null, modelId: null, instructionVersion: null, pageText: '' }];
    } else {
      const gathered = await gatherWebEvidence(deps, contract, window, now);
      items = gathered.items;
      costs.push(...gathered.costs);
    }
  } catch (error) {
    if (!isOutage(error)) throw error;
    // Outage: no evidence, no verdict; look again soon, backing off as the claim ages (1 h … 24 h).
    const wait = Math.min(DAY_MS, Math.max(HOUR_MS, now.getTime() - claim.deadlineAt.getTime()));
    await db.transaction(async (tx) => {
      await tx.update(claims).set({ nextCheckAt: new Date(now.getTime() + wait) }).where(eq(claims.id, claim.id));
      await recordCosts(tx, withClaim(costs, claim.id));
    });
    log('warn', 'source unavailable; claim waits', { event: 'resolver.outage', claim_id: claim.id, slug: claim.slug, error: String(error) });
    return 'outage';
  }

  // Write this run's evidence (insert-only), then decide over all runs.
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx.insert(evidences).values(items.map((item) => ({
      claimId: claim.id,
      runAt: now,
      sourceKind: item.draft.sourceKind,
      basis: item.draft.basis,
      sourceName: item.sourceName,
      trustLevel: item.draft.trustLevel,
      says: item.draft.says,
      eventDate: item.draft.eventDate,
      value: item.value?.toString() ?? null,
      url: item.draft.url,
      contentSha256: item.contentSha256,
      searchQuery: item.searchQuery,
      retrievedAt: item.draft.retrievedAt,
      modelId: item.modelId,
      instructionVersion: item.instructionVersion,
      gates: item.gates,
      passed: item.passed,
    }))).returning({ id: evidences.id });
    await recordCosts(tx, withClaim(costs, claim.id));
    return rows;
  });
  const byId = new Map(inserted.map((row, i) => [row.id, items[i]!]));

  const history = await db.select({ id: evidences.id, runAt: evidences.runAt, trustLevel: evidences.trustLevel, says: evidences.says, passed: evidences.passed })
    .from(evidences).where(eq(evidences.claimId, claim.id));
  const decision = decideResolution(history, now, claim.deadlineAt);
  const outcome = await applyDecision(deps, claim, contract, window, decision, byId, now);
  await checkBudget(db, claim);
  return outcome;
}

async function applyDecision(
  deps: ResolverDeps,
  claim: ClaimRow,
  contract: ReturnType<typeof ContractSchema.parse>,
  window: { lockAt: Date; deadlineAt: Date },
  decision: Decision,
  thisRun: Map<string, GatheredItem>,
  now: Date,
): Promise<ClaimRunOutcome> {
  const { db } = deps;
  const base = { claimId: claim.id, policyVersion: deps.policy.version };

  if (decision.kind === 'wait') {
    const runs = await db.selectDistinct({ runAt: evidences.runAt }).from(evidences).where(eq(evidences.claimId, claim.id));
    const days = Math.min(8, 2 ** Math.max(0, runs.length - 1)); // 1, 2, 4, 8 days
    await db.update(claims).set({ nextCheckAt: new Date(now.getTime() + days * DAY_MS) }).where(eq(claims.id, claim.id));
    log('info', 'claim waits', { event: 'resolution.wait', claim_id: claim.id, slug: claim.slug, reason: decision.reason, next_in_days: days });
    return 'waiting';
  }

  if (decision.kind === 'final') {
    await finalize(db, claim, {
      ...base, outcome: decision.outcome, decidedBy: 'evidence', reviewStatus: 'final', decidedAt: now,
      ...(decision.outcome === 'void' ? { voidReason: decision.voidReason } : { decidingEvidenceId: decision.decidingEvidenceId }),
    });
    return 'final';
  }

  if (decision.kind === 'needs_arbiter') {
    const candidates = decision.candidateIds.map((id) => ({ id, item: thisRun.get(id)! }));
    const { answer, costs } = await arbitrate(deps.llm, deps.arbiterModel, contract, window, candidates.map(({ item }) => ({
      sourceName: item.sourceName, trustLevel: item.draft.trustLevel, says: item.draft.says, eventDate: item.draft.eventDate,
      url: item.draft.url ?? '', sha256: item.contentSha256 ?? '', text: item.pageText,
    })));
    await recordCosts(db, withClaim(costs, claim.id));
    if (answer.decision === 'decided' && answer.deciding_index !== null && answer.outcome) {
      await finalize(db, claim, {
        ...base, outcome: answer.outcome, decidedBy: 'arbiter', reviewStatus: 'final', decidedAt: now,
        decidingEvidenceId: candidates[answer.deciding_index]!.id, arbiterModelId: deps.arbiterModel, arbiterNotes: answer.notes,
      });
      return 'final';
    }
    await flagForHuman(db, claim, { ...base, arbiterModelId: deps.arbiterModel, arbiterNotes: answer.notes }, 'arbiter_cannot_decide');
    return 'needs_human';
  }

  await flagForHuman(db, claim, base, decision.reason);
  return 'needs_human';
}

async function finalize(db: Db, claim: ClaimRow, row: typeof resolutions.$inferInsert): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(resolutions).values(row);
    await tx.update(claims).set({ status: row.outcome === 'void' ? 'void' : 'resolved', nextCheckAt: null }).where(eq(claims.id, claim.id));
  });
  log('info', 'claim resolved', { event: 'resolution.decided', claim_id: claim.id, slug: claim.slug, outcome: row.outcome, decided_by: row.decidedBy, void_reason: row.voidReason });
}

// The claim stays `resolving`; its resolution row keeps it out of later runs until a human decides.
async function flagForHuman(db: Db, claim: ClaimRow, row: Omit<typeof resolutions.$inferInsert, 'reviewStatus'>, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(resolutions).values({ ...row, reviewStatus: 'needs_human' });
    await tx.update(claims).set({ nextCheckAt: null }).where(eq(claims.id, claim.id));
  });
  alert('resolution.needs_human', { claim_id: claim.id, slug: claim.slug, reason });
}

async function checkBudget(db: Db, claim: ClaimRow): Promise<void> {
  const [row] = await db.select({ usd: sql<string>`coalesce(sum(${costEvents.usdCost}), 0)` }).from(costEvents).where(eq(costEvents.claimId, claim.id));
  const usd = Number(row?.usd ?? 0);
  if (usd > CLAIM_BUDGET_USD) alert('claim.over_budget', { claim_id: claim.id, slug: claim.slug, usd_cost: usd });
}

function isOutage(error: unknown): boolean {
  return error instanceof FeedUnavailable || error instanceof SourceUnavailable || error instanceof LlmUnavailable || error instanceof LlmSchemaError;
}

const withClaim = (costs: CallCost[], claimId: string) => costs.map((cost) => ({ ...cost, claimId }));
