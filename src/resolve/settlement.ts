// The one writer of a settlement outcome (003 FR-027). A price verdict is read a second time before it can
// move money: the window is 72 hours and the weekly recheck does not fit in it (docs/decisions/002-escrow-v1.md).
import { and, eq } from 'drizzle-orm';
import { claims, DECIDED_BY, resolutions, settlementOutbox } from '../db/schema.js';
import { log } from '../log.js';
import { alert, captureError } from '../observe.js';
import { rejudgeClaim } from './recheck.js';
import { isOutage, type ResolverDeps } from './resolver.js';

type Decider = (typeof DECIDED_BY)[number];

// Who may decide a verdict that moves a stake. A deciding source added later — Stage 3's local verifier —
// is absent from this list, so it settles nothing until someone adds it on purpose (FR-031).
const SETTLES: ReadonlySet<Decider> = new Set<Decider>([
  'evidence',
  'arbiter',
  'human',
]);

export type Confirmed = { confirmed: number; held: number; skipped: number };

// Runs before the resolver in the same job, so a verdict written this hour gets its second read the next.
export async function confirmStakedVerdicts(
  deps: ResolverDeps,
  now: Date,
): Promise<Confirmed> {
  const due = await deps.db
    .select({
      claimId: settlementOutbox.claimId,
      slug: claims.slug,
      outcome: resolutions.outcome,
      decidedBy: resolutions.decidedBy,
    })
    .from(settlementOutbox)
    .innerJoin(claims, eq(claims.id, settlementOutbox.claimId))
    .innerJoin(resolutions, eq(resolutions.claimId, settlementOutbox.claimId))
    .where(
      and(eq(settlementOutbox.state, 'open'), eq(resolutions.reviewStatus, 'final')),
    );

  const result: Confirmed = { confirmed: 0, held: 0, skipped: 0 };
  // One second read per claim, however many networks it is on: the update below moves all its rows (FR-036d).
  const claimsDue = [...new Map(due.map((row) => [row.claimId, row])).values()];
  for (const row of claimsDue) {
    if (!row.outcome || !row.decidedBy || !SETTLES.has(row.decidedBy)) {
      result.skipped++;
      continue;
    }
    // A human's verdict is already the second look; anything else is read again from the source.
    let agrees: boolean;
    try {
      agrees =
        row.decidedBy === 'human' || (await secondReadAgrees(deps, row.slug, now));
    } catch (error) {
      // Either way the row stays open and is tried next run, and one bad claim never stops the others.
      // An outage is not a disagreement (INIT_SPEC §6.7); anything else is a defect, and reported as one.
      if (isOutage(error)) {
        log('warn', 'second read failed; retried next run', {
          event: 'settlement.second_read_failed',
          slug: row.slug,
          error: String(error),
        });
      } else {
        captureError(error, { event: 'settlement.confirm_failed', slug: row.slug });
      }
      result.skipped++;
      continue;
    }
    const state = agrees ? 'pending' : 'held';
    const set = await deps.db
      .update(settlementOutbox)
      .set({ outcome: row.outcome, state })
      .where(
        and(
          eq(settlementOutbox.claimId, row.claimId),
          eq(settlementOutbox.state, 'open'),
        ),
      )
      .returning({ claimId: settlementOutbox.claimId });
    if (set.length === 0) continue; // another run got there first
    if (agrees) {
      result.confirmed++;
      log('info', 'stake verdict confirmed', {
        event: 'settlement.confirmed',
        slug: row.slug,
        outcome: row.outcome,
      });
    } else {
      result.held++;
      // Nothing settles a held claim; its stakes refund at the timeout. A human decides what is published.
      alert('settlement.verdict_held', { slug: row.slug, outcome: row.outcome });
    }
  }
  return result;
}

async function secondReadAgrees(
  deps: ResolverDeps,
  slug: string,
  now: Date,
): Promise<boolean> {
  const check = await rejudgeClaim(deps, slug, now);
  return check !== null && !check.differs && !check.unsettled;
}

// The confirm step never blocks the resolver: a failure here is reported and every other verdict is still
// decided this run. A stake can wait an hour; every claim's verdict cannot wait on one stake.
export async function confirmBeforeResolving(
  deps: ResolverDeps,
  now: Date,
): Promise<void> {
  try {
    await confirmStakedVerdicts(deps, now);
  } catch (error) {
    captureError(error, { event: 'settlement.confirm_run_failed' });
  }
}
