// Re-run today's rules over a verdict already given (001 FR-035). The stored resolution is frozen and
// stays; a different answer is written as a correction beside it.
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { claims, corrections, evidences, resolutions } from '../db/schema.js';
import type { CallCost } from '../llm/client.js';
import { log } from '../log.js';
import { decideResolution, type Decision } from './decide.js';
import { checkBudget, gatherEvidence, type ResolverDeps, storeEvidence } from './resolver.js';

export type Recheck = {
  slug: string;
  was: 'hit' | 'miss' | 'void';
  now: Decision;
  differs: boolean; // today's rules reach a different verdict
  unsettled: boolean; // today's rules would not settle it at all — the arbiter or a human would
  corrected: boolean;
};

// Decision from the evidence already stored: no searches, no pages, no model — it costs nothing, and it
// is what catches a rule that was wrong when the verdict was given.
export async function recheckClaim(db: Db, slug: string, at: Date): Promise<Recheck | null> {
  const [row] = await db
    .select({ id: claims.id, deadlineAt: claims.deadlineAt, outcome: resolutions.outcome, status: resolutions.reviewStatus })
    .from(claims).innerJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(and(eq(claims.slug, slug), eq(resolutions.reviewStatus, 'final')))
    .limit(1);
  if (!row?.outcome || !row.deadlineAt) return null;

  const history = await db
    .select({ id: evidences.id, runAt: evidences.runAt, trustLevel: evidences.trustLevel, says: evidences.says, basis: evidences.basis, passed: evidences.passed, gates: evidences.gates })
    .from(evidences).where(eq(evidences.claimId, row.id));
  const decision = decideResolution(history.map(({ gates, ...e }) => ({ ...e, quoteFound: gates.quote_found ?? null })), at, row.deadlineAt);
  const differs = decision.kind === 'final' && decision.outcome !== row.outcome;
  return { slug, was: row.outcome, now: decision, differs, unsettled: decision.kind !== 'final', corrected: false };
}

// A verdict re-examined with pages fetched and judged again (004 T415a): the only way to catch a judging
// error, because a free recheck re-reads the same stored answers. Paid, so it is never run by a schedule.
// Writes a new evidence run and no resolution — the published one is frozen (001 FR-035).
export async function rejudgeClaim(deps: ResolverDeps, slug: string, at: Date): Promise<Recheck | null> {
  const [row] = await deps.db
    .select({ id: claims.id, contract: claims.contract, lockAt: claims.lockAt, deadlineAt: claims.deadlineAt, outcome: resolutions.outcome })
    .from(claims).innerJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(and(eq(claims.slug, slug), eq(resolutions.reviewStatus, 'final')))
    .limit(1);
  if (!row?.outcome || !row.deadlineAt || !row.lockAt || !row.contract) return null;

  const contract = ContractSchema.parse(row.contract);
  const window = { lockAt: row.lockAt, deadlineAt: row.deadlineAt };
  const costs: CallCost[] = [];
  const items = await gatherEvidence(deps, contract, window, at, costs);
  await storeEvidence(deps.db, row.id, items, costs, at);
  const spent = costs.reduce((total, cost) => total + cost.usdCost, 0);
  log('info', 'verdict re-judged', { event: 'recheck.rejudged', slug, pages: items.length, usd_cost: spent });
  // A claim can be re-judged more than once, and each run adds to what it has cost (INIT_SPEC §9).
  await checkBudget(deps.db, { id: row.id, slug });
  return recheckClaim(deps.db, slug, at);
}

// Every final verdict of the last `days`, re-decided. Reports; it never writes (001 FR-035).
export async function recheckRecent(db: Db, at: Date, days = 7): Promise<Recheck[]> {
  const since = new Date(at.getTime() - days * 24 * 3_600_000);
  const recent = await db
    .select({ slug: claims.slug })
    .from(resolutions).innerJoin(claims, eq(claims.id, resolutions.claimId))
    .where(and(eq(resolutions.reviewStatus, 'final'), gt(resolutions.decidedAt, since), isNull(corrections.id)))
    .leftJoin(corrections, eq(corrections.claimId, claims.id))
    .orderBy(desc(resolutions.decidedAt));
  const out: Recheck[] = [];
  for (const { slug } of recent) {
    const result = await recheckClaim(db, slug, at);
    if (result) out.push(result);
  }
  const differing = out.filter((r) => r.differs);
  const unsettled = out.filter((r) => r.unsettled);
  log('info', 'verdicts rechecked', {
    event: 'recheck.run', checked: out.length, differing: differing.length, unsettled: unsettled.length,
    slugs: differing.map((r) => r.slug), unsettled_slugs: unsettled.map((r) => r.slug),
  });
  return out;
}

// Writing the correction is a separate step: a recheck never changes a published verdict on its own
// (001 FR-035). The row is what the public pages read; the frozen resolution is never touched.
export async function writeCorrection(db: Db, slug: string, check: Recheck, reason: string): Promise<boolean> {
  if (!check.differs || check.now.kind !== 'final' || check.now.outcome === 'void') return false;
  const [claim] = await db.select({ id: claims.id }).from(claims).where(eq(claims.slug, slug)).limit(1);
  if (!claim) return false;
  const written = await db.insert(corrections).values({
    claimId: claim.id,
    fromOutcome: check.was,
    toOutcome: check.now.outcome,
    reason,
    decidingEvidenceId: 'decidingEvidenceId' in check.now ? check.now.decidingEvidenceId : null,
    decidedBy: 'evidence',
  }).onConflictDoNothing().returning({ id: corrections.id });
  if (written.length === 0) return false;
  log('info', 'verdict corrected', { event: 'recheck.corrected', slug, from: check.was, to: check.now.outcome, reason });
  return true;
}
