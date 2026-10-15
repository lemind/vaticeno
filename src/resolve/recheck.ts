// Re-run today's rules over a verdict already given (001 FR-035). The stored resolution is frozen and
// stays; a different answer is written as a correction beside it.
import { and, desc, eq, gt, inArray, isNull, sql as raw } from 'drizzle-orm';
import {
  type Contract,
  ContractSchema,
  SCHEDULED_EVENT_KINDS,
} from '../contract/schema.js';
import { resolveFollowerContract, type UserLookup } from '../contract/x-profile.js';
import { findFixture } from '../llm/fixture.js';
import { X_POST_READ_USD } from '../x/prices.js';
import type { Db } from '../db/client.js';
import {
  claims,
  corrections,
  evidences,
  recheckFindings,
  resolutions,
} from '../db/schema.js';
import type { CallCost } from '../llm/client.js';
import { log } from '../log.js';
import { decideResolution, type Decision } from './decide.js';
import {
  checkBudget,
  gatherEvidence,
  type ResolverDeps,
  storeEvidence,
} from './resolver.js';

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
export async function recheckClaim(
  db: Db,
  slug: string,
  at: Date,
): Promise<Recheck | null> {
  const [row] = await db
    .select({
      id: claims.id,
      deadlineAt: claims.deadlineAt,
      outcome: resolutions.outcome,
      status: resolutions.reviewStatus,
    })
    .from(claims)
    .innerJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(and(eq(claims.slug, slug), eq(resolutions.reviewStatus, 'final')))
    .limit(1);
  if (!row?.outcome || !row.deadlineAt) return null;

  const history = await db
    .select({
      id: evidences.id,
      runAt: evidences.runAt,
      trustLevel: evidences.trustLevel,
      says: evidences.says,
      basis: evidences.basis,
      passed: evidences.passed,
      gates: evidences.gates,
    })
    .from(evidences)
    .where(eq(evidences.claimId, row.id));
  const decision = decideResolution(
    history.map(({ gates, ...e }) => ({
      ...e,
      quoteFound: gates.quote_found ?? null,
    })),
    at,
    row.deadlineAt,
  );
  const differs = decision.kind === 'final' && decision.outcome !== row.outcome;
  return {
    slug,
    was: row.outcome,
    now: decision,
    differs,
    unsettled: decision.kind !== 'final',
    corrected: false,
  };
}

// Pages fetched and judged again: the only way to catch a judging error (004 FR-011). Paid, never
// scheduled, and it writes a new evidence run beside the frozen resolution (001 FR-035).
export async function rejudgeClaim(
  deps: ResolverDeps,
  slug: string,
  at: Date,
): Promise<Recheck | null> {
  const [row] = await deps.db
    .select({
      id: claims.id,
      contract: claims.contract,
      lockAt: claims.lockAt,
      deadlineAt: claims.deadlineAt,
      outcome: resolutions.outcome,
      authorXUserId: claims.authorXUserId,
      sourceTweetId: claims.sourceTweetId,
      createdAt: claims.createdAt,
    })
    .from(claims)
    .innerJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(and(eq(claims.slug, slug), eq(resolutions.reviewStatus, 'final')))
    .limit(1);
  if (!row?.outcome || !row.deadlineAt || !row.lockAt || !row.contract) return null;

  const window = { lockAt: row.lockAt, deadlineAt: row.deadlineAt };
  const costs: CallCost[] = [];
  const contract = await readAsRecordedToday(
    deps,
    ContractSchema.parse(row.contract),
    row,
    costs,
  );
  const items = await gatherEvidence(deps, contract, window, at, costs);
  await storeEvidence(deps.db, row.id, items, costs, at);
  const spent = costs.reduce((total, cost) => total + cost.usdCost, 0);
  log('info', 'verdict re-judged', {
    event: 'recheck.rejudged',
    slug,
    pages: items.length,
    usd_cost: spent,
  });
  // A claim can be re-judged more than once, and each run adds to what it has cost (INIT_SPEC §9).
  await checkBudget(deps.db, { id: row.id, slug });
  return recheckClaim(deps.db, slug, at);
}

// A contract locked before 004 T418–T419, read as recording reads it today. In memory only: a locked
// contract is never written (INIT_SPEC §4).
async function readAsRecordedToday(
  deps: ResolverDeps,
  contract: Contract,
  claim: { authorXUserId: string; sourceTweetId: string; createdAt: Date },
  costs: CallCost[],
): Promise<Contract> {
  const recordedAt = claim.createdAt;
  // Post text is never stored (§6.9), so it is read again from X: it names the account, the contract does not.
  if (!contract.followers && deps.x?.getTweet) {
    const post = await deps.x.getTweet(claim.sourceTweetId);
    costs.push({
      provider: 'x',
      operation: 'thread_read',
      units: 1,
      usdCost: X_POST_READ_USD,
    });
    const lookup = deps.x.getUserByUsername ? (deps.x as UserLookup) : undefined;
    const followers = await resolveFollowerContract(
      lookup,
      deps.botHandle ?? 'vaticeno',
      contract,
      post.text,
      claim.authorXUserId,
      costs,
    );
    if (followers !== contract) return followers;
  }
  if (
    SCHEDULED_EVENT_KINDS.includes(contract.source.kind) &&
    !contract.event_start_at &&
    deps.normalizerModel
  ) {
    const { fixture, costs: spent } = await findFixture(
      deps.llm,
      deps.normalizerModel,
      contract,
      recordedAt,
    );
    costs.push(...spent);
    const kickoff = fixture.kickoff_utc ? Date.parse(fixture.kickoff_utc) : NaN;
    if (!Number.isNaN(kickoff))
      return { ...contract, event_start_at: new Date(kickoff).toISOString() };
  }
  return contract;
}

// Every final verdict of the last `days`, re-decided. It never touches a published verdict (001 FR-035);
// what it does write is the finding itself, so a disagreement outlives the window (003 FR-007a).
export async function recheckRecent(db: Db, at: Date, days = 7): Promise<Recheck[]> {
  const since = new Date(at.getTime() - days * 24 * 3_600_000);
  const recent = await db
    .select({ slug: claims.slug, claimId: claims.id })
    .from(resolutions)
    .innerJoin(claims, eq(claims.id, resolutions.claimId))
    .where(
      and(
        eq(resolutions.reviewStatus, 'final'),
        gt(resolutions.decidedAt, since),
        isNull(corrections.id),
      ),
    )
    .leftJoin(corrections, eq(corrections.claimId, claims.id))
    .orderBy(desc(resolutions.decidedAt));
  const out: Recheck[] = [];
  const ids = new Map<string, string>();
  for (const { slug, claimId } of recent) {
    const result = await recheckClaim(db, slug, at);
    if (!result) continue;
    out.push(result);
    ids.set(slug, claimId);
  }
  await recordFindings(db, out, ids, at);
  const differing = out.filter((r) => r.differs);
  const unsettled = out.filter((r) => r.unsettled);
  log('info', 'verdicts rechecked', {
    event: 'recheck.run',
    checked: out.length,
    differing: differing.length,
    unsettled: unsettled.length,
    slugs: differing.map((r) => r.slug),
    unsettled_slugs: unsettled.map((r) => r.slug),
  });
  return out;
}

// A finding outlives the seven-day window the recheck looks at, so a verdict known to be wrong keeps
// saying so until a correction answers it (003 FR-007a). The log line is not the record.
async function recordFindings(
  db: Db,
  results: readonly Recheck[],
  ids: Map<string, string>,
  at: Date,
): Promise<void> {
  const rows = results
    .filter((result) => result.differs || result.unsettled)
    .flatMap((result) => {
      const claimId = ids.get(result.slug);
      if (!claimId) return [];
      const outcome = result.now.kind === 'final' ? result.now.outcome : null;
      const differs = result.differs && outcome !== null;
      return [
        {
          claimId,
          foundAt: at,
          lastSeenAt: at,
          publishedOutcome: result.was,
          recheckOutcome: differs ? outcome : null,
          kind: differs ? ('differs' as const) : ('unsettled' as const),
        },
      ];
    });
  if (rows.length > 0) {
    await db
      .insert(recheckFindings)
      .values(rows)
      .onConflictDoUpdate({
        target: recheckFindings.claimId,
        // `found_at` and `cleared_at` are left alone: the first sighting is the age the page shows.
        set: {
          lastSeenAt: raw`excluded.last_seen_at`,
          publishedOutcome: raw`excluded.published_outcome`,
          recheckOutcome: raw`excluded.recheck_outcome`,
          kind: raw`excluded.kind`,
        },
      });
  }
  // A correction answers the finding. Cleared, never deleted: the row is the record that the loop closed.
  const cleared = await db
    .update(recheckFindings)
    .set({ clearedAt: at })
    .where(
      and(
        isNull(recheckFindings.clearedAt),
        inArray(
          recheckFindings.claimId,
          db.select({ id: corrections.claimId }).from(corrections),
        ),
      ),
    )
    .returning({ claimId: recheckFindings.claimId });
  log('info', 'recheck findings recorded', {
    event: 'recheck.findings',
    open: rows.length,
    cleared: cleared.length,
  });
}

// Writing the correction is a separate step: a recheck never changes a published verdict on its own
// (001 FR-035). The row is what the public pages read; the frozen resolution is never touched.
// A standing verdict corrected by hand (004 T424): the owner reads the evidence already stored and says
// what it shows. For when the rules now reach the right answer but re-judging would pass the claim's
// budget. The frozen resolution is never touched — the correction stands beside it (INIT_SPEC §4).
export async function correctByHand(
  db: Db,
  slug: string,
  outcome: 'hit' | 'miss',
  decidingEvidenceId: string,
  reason: string,
): Promise<boolean> {
  if (!reason.trim())
    throw new Error('a reason is required: it is shown on the claim page');
  const [row] = await db
    .select({ id: claims.id, was: resolutions.outcome })
    .from(claims)
    .innerJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(and(eq(claims.slug, slug), eq(resolutions.reviewStatus, 'final')))
    .limit(1);
  if (!row?.was) throw new Error(`no final verdict for ${slug}`);
  if (row.was === outcome)
    throw new Error(`#${slug} already stands at ${outcome}; nothing to correct`);
  const [evidence] = await db
    .select({ id: evidences.id })
    .from(evidences)
    .where(and(eq(evidences.id, decidingEvidenceId), eq(evidences.claimId, row.id)))
    .limit(1);
  if (!evidence)
    throw new Error('--deciding-evidence must be an evidence row of this claim');

  const written = await db
    .insert(corrections)
    .values({
      claimId: row.id,
      fromOutcome: row.was,
      toOutcome: outcome,
      reason: reason.trim(),
      decidingEvidenceId,
      decidedBy: 'human',
    })
    .onConflictDoNothing()
    .returning({ id: corrections.id });
  if (written.length === 0) return false;
  log('info', 'verdict corrected by hand', {
    event: 'recheck.corrected',
    slug,
    from: row.was,
    to: outcome,
    decided_by: 'human',
    reason,
  });
  return true;
}

export async function writeCorrection(
  db: Db,
  slug: string,
  check: Recheck,
  reason: string,
): Promise<boolean> {
  if (!check.differs || check.now.kind !== 'final' || check.now.outcome === 'void')
    return false;
  const [claim] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.slug, slug))
    .limit(1);
  if (!claim) return false;
  const written = await db
    .insert(corrections)
    .values({
      claimId: claim.id,
      fromOutcome: check.was,
      toOutcome: check.now.outcome,
      reason,
      decidingEvidenceId:
        'decidingEvidenceId' in check.now ? check.now.decidingEvidenceId : null,
      decidedBy: 'evidence',
    })
    .onConflictDoNothing()
    .returning({ id: corrections.id });
  if (written.length === 0) return false;
  log('info', 'verdict corrected', {
    event: 'recheck.corrected',
    slug,
    from: check.was,
    to: check.now.outcome,
    reason,
  });
  return true;
}
