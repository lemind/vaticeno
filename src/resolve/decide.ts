// The resolution rule table (data-model "How the resolution is reached"). Pure.
// HIT/MISS/contradiction come from the latest run only; the waiting rules also count earlier runs.
import type { TrustLevel } from './trust.js';

export type EvidenceRow = {
  id: string;
  runAt: Date;
  trustLevel: TrustLevel;
  says: 'hit' | 'miss' | 'pending' | 'irrelevant' | 'entity_gone';
  passed: boolean;
};

export type Decision =
  | { kind: 'final'; outcome: 'hit' | 'miss'; decidingEvidenceId: string }
  | { kind: 'final'; outcome: 'void'; voidReason: 'insufficient_evidence' | 'unresolvable' }
  | { kind: 'needs_arbiter'; candidateIds: string[] }
  | { kind: 'needs_human'; reason: 'lone_trusted' | 'pending_too_long' }
  | { kind: 'wait'; reason: 'no_evidence' | 'pending' | 'entity_gone' | 'insufficient_once' };

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_LIMIT_MS = 30 * DAY_MS;
const ENTITY_GONE_RUNS = 3;

export function decideResolution(evidences: readonly EvidenceRow[], now: Date, deadlineAt: Date): Decision {
  const runs = distinctRuns(evidences);
  const latestRun = runs.at(-1);
  if (latestRun === undefined) return { kind: 'wait', reason: 'no_evidence' }; // outage: nothing was written
  const latest = evidences.filter((e) => e.runAt.getTime() === latestRun);

  // An official source says the entity no longer exists: VOID only after 3 separate runs say so.
  if (latest.some((e) => e.trustLevel === 'official' && e.says === 'entity_gone')) {
    const goneRuns = distinctRuns(evidences.filter((e) => e.trustLevel === 'official' && e.says === 'entity_gone'));
    if (goneRuns.length >= ENTITY_GONE_RUNS) return { kind: 'final', outcome: 'void', voidReason: 'unresolvable' };
    return { kind: 'wait', reason: 'entity_gone' };
  }

  // An official source says the result exists but is not final yet: wait; after 30 days a human decides.
  if (latest.some((e) => e.trustLevel === 'official' && e.says === 'pending')) {
    if (now.getTime() - deadlineAt.getTime() > PENDING_LIMIT_MS) return { kind: 'needs_human', reason: 'pending_too_long' };
    return { kind: 'wait', reason: 'pending' };
  }

  const counted = latest.filter((e) => e.passed && (e.says === 'hit' || e.says === 'miss'));

  // Only the highest trust level present decides; disagreement within it goes to the arbiter.
  const officials = counted.filter((e) => e.trustLevel === 'official');
  if (officials.length > 0) return agreeOrArbiter(officials);

  const trusted = counted.filter((e) => e.trustLevel === 'trusted');
  if (trusted.length >= 2) return agreeOrArbiter(trusted);
  if (trusted.length === 1) return { kind: 'needs_human', reason: 'lone_trusted' };

  // Nothing counts. VOID needs a second such run at least 24 h earlier (results may be reported late).
  const earlierEmpty = runs.slice(0, -1).some((run) => latestRun - run >= DAY_MS && !runHasCounted(evidences, run));
  if (earlierEmpty) return { kind: 'final', outcome: 'void', voidReason: 'insufficient_evidence' };
  return { kind: 'wait', reason: 'insufficient_once' };
}

function agreeOrArbiter(items: readonly EvidenceRow[]): Decision {
  const first = items[0]!;
  if (items.every((e) => e.says === first.says)) {
    return { kind: 'final', outcome: first.says as 'hit' | 'miss', decidingEvidenceId: first.id };
  }
  return { kind: 'needs_arbiter', candidateIds: items.map((e) => e.id) };
}

function distinctRuns(evidences: readonly EvidenceRow[]): number[] {
  return [...new Set(evidences.map((e) => e.runAt.getTime()))].sort((a, b) => a - b);
}

function runHasCounted(evidences: readonly EvidenceRow[], run: number): boolean {
  return evidences.some((e) => e.runAt.getTime() === run && e.passed && (e.says === 'hit' || e.says === 'miss'));
}
