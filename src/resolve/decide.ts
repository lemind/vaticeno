// The resolution rule table (data-model "How the resolution is reached"). Pure.
// HIT/MISS/contradiction come from the latest run only; the waiting rules also count earlier runs.
import type { TrustLevel } from './trust.js';

export type EvidenceRow = {
  id: string;
  runAt: Date;
  trustLevel: TrustLevel;
  says: 'hit' | 'miss' | 'pending' | 'irrelevant' | 'entity_gone';
  basis: 'record' | 'absence';
  passed: boolean;
  quoteFound: boolean | null; // the quote gate; null = not applicable (price feed)
};

export type Decision =
  | { kind: 'final'; outcome: 'hit' | 'miss'; decidingEvidenceId: string }
  | { kind: 'final'; outcome: 'void'; voidReason: 'insufficient_evidence' | 'unresolvable' }
  | { kind: 'needs_arbiter'; candidateIds: string[] }
  | { kind: 'needs_human'; reason: 'lone_established' | 'pending_too_long' }
  | { kind: 'wait'; reason: 'no_evidence' | 'pending' | 'entity_gone' | 'insufficient_once' };

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_LIMIT_MS = 30 * DAY_MS;
const ENTITY_GONE_RUNS = 3;

export function decideResolution(evidences: readonly EvidenceRow[], now: Date, deadlineAt: Date): Decision {
  const runs = distinctRuns(evidences);
  const latestRun = runs.at(-1);
  if (latestRun === undefined) return { kind: 'wait', reason: 'no_evidence' }; // outage: nothing was written
  const latest = evidences.filter((e) => e.runAt.getTime() === latestRun);

  // A primary source says the entity no longer exists: VOID only after 3 separate runs say so.
  if (latest.some((e) => primarySays(e, 'entity_gone'))) {
    const goneRuns = distinctRuns(evidences.filter((e) => primarySays(e, 'entity_gone')));
    if (goneRuns.length >= ENTITY_GONE_RUNS) return { kind: 'final', outcome: 'void', voidReason: 'unresolvable' };
    return { kind: 'wait', reason: 'entity_gone' };
  }

  // A primary source says the result exists but is not final yet: wait; after 30 days a human decides.
  if (latest.some((e) => primarySays(e, 'pending'))) {
    if (now.getTime() - deadlineAt.getTime() > PENDING_LIMIT_MS) return { kind: 'needs_human', reason: 'pending_too_long' };
    return { kind: 'wait', reason: 'pending' };
  }

  // Weak sources never decide anything; in production the trust gate already fails them.
  const counted = latest.filter((e) => e.passed && e.trustLevel !== 'weak' && (e.says === 'hit' || e.says === 'miss'));

  // A page that did not list the event cannot outrank pages reporting it, however trusted that page is:
  // a wrong MISS went out because one primary fixtures list beat three reports of the score
  // (owner decision 2026-10-12, 001 FR-034). Records decide; an absence only when none passed.
  const records = counted.filter((e) => e.basis === 'record');
  if (records.length > 0) return weighEvidence(records);
  const absences = counted.filter((e) => e.basis === 'absence');
  if (absences.length > 0) return weighEvidence(absences);

  // Nothing counts. VOID needs a second such run at least 24 h earlier (results may be reported late).
  const earlierEmpty = runs.slice(0, -1).some((run) => latestRun - run >= DAY_MS && runIsEmpty(evidences, run));
  if (earlierEmpty) return { kind: 'final', outcome: 'void', voidReason: 'insufficient_evidence' };
  return { kind: 'wait', reason: 'insufficient_once' };
}

// Every passed item is compared, whatever its tier; they must agree. Disagreement is for the arbiter,
// which sees them all, rather than for whichever tier happens to be highest (001 FR-034).
function weighEvidence(items: readonly EvidenceRow[]): Decision {
  const primary = items.filter((e) => e.trustLevel === 'primary');
  const established = items.filter((e) => e.trustLevel === 'established');
  if (primary.length === 0 && established.length === 1) return { kind: 'needs_human', reason: 'lone_established' };
  const first = items[0]!;
  if (!items.every((e) => e.says === first.says)) return { kind: 'needs_arbiter', candidateIds: items.map((e) => e.id) };
  // The most trusted of the agreeing items is the one the reply cites.
  const deciding = primary[0] ?? established[0] ?? first;
  return { kind: 'final', outcome: first.says as 'hit' | 'miss', decidingEvidenceId: deciding.id };
}

function distinctRuns(evidences: readonly EvidenceRow[]): number[] {
  return [...new Set(evidences.map((e) => e.runAt.getTime()))].sort((a, b) => a - b);
}

// pending / entity_gone fail the `final` gate by design, so they are read here without `passed`; they
// still need the page to back them (quote found; price feed has no quote).
function primarySays(e: Pick<EvidenceRow, 'trustLevel' | 'says' | 'quoteFound'>, says: 'pending' | 'entity_gone'): boolean {
  return e.trustLevel === 'primary' && e.says === says && e.quoteFound !== false;
}

// Evidence that settles something: a passed HIT/MISS, or a primary "pending" / "entity gone". A run with
// none is empty (it can count toward VOID); a run with some is never an outage.
export function settles(e: Pick<EvidenceRow, 'trustLevel' | 'says' | 'passed' | 'quoteFound'>): boolean {
  return (e.passed && (e.says === 'hit' || e.says === 'miss')) || primarySays(e, 'pending') || primarySays(e, 'entity_gone');
}

function runIsEmpty(evidences: readonly EvidenceRow[], run: number): boolean {
  return !evidences.some((e) => e.runAt.getTime() === run && settles(e));
}
