// Evidence gates (data-model "Evidence gates"). Model flags are inputs, never the final word. Pure.
import type { EVIDENCE_BASES, EVIDENCE_SAYS, SOURCE_KINDS } from '../db/schema.js';
import { isExhaustiveRecord } from './exhaustive.js';
import type { EventMatch } from './relevance.js';
import type { TrustLevel } from './trust.js';

export type EvidenceDraft = {
  sourceKind: (typeof SOURCE_KINDS)[number];
  basis: (typeof EVIDENCE_BASES)[number];
  trustLevel: TrustLevel;
  says: (typeof EVIDENCE_SAYS)[number];
  eventDate: string | null; // YYYY-MM-DD
  eventStart: string | null; // UTC date-time the event began, when the page states it
  url: string | null;
  retrievedAt: Date;
  quoteFound: boolean | null; // computed in memory from the page (or replayed); null = no quote given
  isFinalResult: boolean;
  originalSource: string | null; // who first reported it, if the page credits one
  simhash: string | null; // near-duplicate fingerprint of the page text
  eventMatch: EventMatch | null; // whether this page shows the contract's own event (004); null = price feed
  selfConsistent: boolean | null; // do the page's own facts agree with the verdict given it? null = not code's to check
};

export type GateName =
  | 'trusted'
  | 'quote_found'
  | 'in_window'
  | 'final'
  | 'independent'
  | 'relevant'
  | 'consistent';
export type Gates = Record<GateName, boolean | null>; // null = not applicable

// Every contract change sets lock_at 15 min later (LOCK_DELAY_MS), so the last change is lock_at − 15 min.
// Bump when a change alters which pages pass: the local verifier reads only passed pages, so its go-live
// count (003 SC-005) starts again for the new version (src/resolve/shadow.ts).
export const GATES_VERSION = 'gates.v1';

const CONTRACT_SET_BEFORE_LOCK_MS = 15 * 60 * 1000;

// `absenceAdmissible` is the code-held list of complete records (exhaustive.ts); injectable so a test can
// name one while the real list is empty.
// `knownStart`: the kickoff the fixture check found at recording, used when a page states only the date (004 T418).
export type Window = {
  lockAt: Date;
  deadlineAt: Date;
  absenceIsMeaningful: boolean;
  startTimeCounts?: boolean;
  knownStart?: Date;
  absenceAdmissible?: (url: string | null) => boolean;
};

export function runGates(
  draft: EvidenceDraft,
  window: Window,
): { gates: Gates; passed: boolean } {
  const isPrice = draft.sourceKind === 'price_feed';
  const gates: Gates = {
    trusted: draft.trustLevel !== 'weak',
    // The waiver is granted by code, not by the model saying "absence" (004 FR-007).
    quote_found:
      isPrice || admissibleAbsence(draft, window) ? null : draft.quoteFound === true,
    in_window: inWindow(draft, window),
    final: draft.isFinalResult && draft.says !== 'pending',
    // Decided after every page is judged, in groups.ts (004 FR-005).
    independent: null,
    // A page about another event decides nothing, and one that will not say which event it shows is not
    // taken for ours: unknown fails closed (004 FR-003). What it said is still stored.
    relevant: isPrice
      ? null
      : draft.eventMatch !== 'no' && draft.eventMatch !== 'unknown',
    // A page whose own facts contradict the verdict it was given counts for nothing (004 FR-009).
    consistent: draft.selfConsistent,
  };
  const passed = Object.values(gates).every((g) => g !== false);
  return { gates, passed };
}

// Silence is proof only from an endpoint code records as complete (004 FR-007): `absence_is_meaningful`
// is model-written, so it cannot be the only key.
function admissibleAbsence(draft: EvidenceDraft, window: Window): boolean {
  return (
    draft.basis === 'absence' &&
    (window.absenceAdmissible ?? isExhaustiveRecord)(draft.url)
  );
}

// Record evidence: the event day is inside (lock, deadline]. Day granularity is conservative: an event on
// the lock day may have happened before lock, so it never counts. Absence evidence: read at/after the
// deadline, and only from the contract's own (primary) source when it marks it exhaustive.
function inWindow(draft: EvidenceDraft, window: Window): boolean {
  if (draft.basis === 'absence') {
    return (
      admissibleAbsence(draft, window) &&
      window.absenceIsMeaningful &&
      draft.trustLevel === 'primary' &&
      draft.says === 'miss' &&
      draft.retrievedAt.getTime() >= window.deadlineAt.getTime()
    );
  }
  if (!draft.eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(draft.eventDate)) return false;
  const lockDay = window.lockAt.toISOString().slice(0, 10);
  const deadlineDay = window.deadlineAt.toISOString().slice(0, 10);
  // Sports matches: the start time when it agrees with the event date, else the day alone, which
  // recording has proven still to come (004 T426; claims.ts confirmFixture).
  if (window.startTimeCounts && draft.sourceKind === 'web') {
    const start = draft.eventStart
      ? Date.parse(draft.eventStart)
      : (window.knownStart?.getTime() ?? NaN);
    if (!Number.isNaN(start) && nearDate(start, draft.eventDate)) {
      return (
        start > window.lockAt.getTime() - CONTRACT_SET_BEFORE_LOCK_MS &&
        start <= window.deadlineAt.getTime()
      );
    }
    // A page that states a time disagreeing with its own date is not trusted for the date either.
    if (draft.eventStart) return false;
    return draft.eventDate >= lockDay && draft.eventDate <= deadlineDay;
  }
  // A daily close happens at the end of its day, so the lock day's close is after lock (price-evidence.ts).
  const afterLock =
    draft.sourceKind === 'price_feed'
      ? draft.eventDate >= lockDay
      : draft.eventDate > lockDay;
  return afterLock && draft.eventDate <= deadlineDay;
}

function nearDate(startMs: number, eventDate: string): boolean {
  const day = Date.parse(`${eventDate}T00:00:00Z`);
  return startMs >= day - DAY_MS && startMs < day + 2 * DAY_MS;
}
const DAY_MS = 24 * 60 * 60 * 1000;
