// Evidence gates (data-model "Evidence gates"). Model flags are inputs, never the final word. Pure.
import type { EVIDENCE_BASES, EVIDENCE_SAYS, SOURCE_KINDS } from '../db/schema.js';
import { nearDuplicate } from './similarity.js';
import { hostOf, registrableDomain, type TrustLevel } from './trust.js';

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
};

export type GateName = 'trusted' | 'quote_found' | 'in_window' | 'final' | 'independent';
export type Gates = Record<GateName, boolean | null>; // null = not applicable

// Every contract change sets lock_at 15 min later (LOCK_DELAY_MS), so the last change is lock_at − 15 min.
const CONTRACT_SET_BEFORE_LOCK_MS = 15 * 60 * 1000;

export type Window = { lockAt: Date; deadlineAt: Date; absenceIsMeaningful: boolean; startTimeCounts?: boolean };

export function runGates(draft: EvidenceDraft, window: Window, accepted: readonly EvidenceDraft[]): { gates: Gates; passed: boolean } {
  const isPrice = draft.sourceKind === 'price_feed';
  const gates: Gates = {
    trusted: draft.trustLevel !== 'weak',
    quote_found: isPrice || draft.basis === 'absence' ? null : draft.quoteFound === true,
    in_window: inWindow(draft, window),
    final: draft.isFinalResult && draft.says !== 'pending',
    independent: isPrice ? null : !accepted.some((other) => sameStory(draft, other)),
  };
  const passed = Object.values(gates).every((g) => g !== false);
  return { gates, passed };
}

// Record evidence: the event day is inside (lock, deadline]. Day granularity is conservative: an event on
// the lock day may have happened before lock, so it never counts. Absence evidence: read at/after the
// deadline, and only from the contract's own (primary) source when it marks it exhaustive.
function inWindow(draft: EvidenceDraft, window: Window): boolean {
  if (draft.basis === 'absence') {
    return window.absenceIsMeaningful && draft.trustLevel === 'primary' && draft.says === 'miss' && draft.retrievedAt.getTime() >= window.deadlineAt.getTime();
  }
  if (!draft.eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(draft.eventDate)) return false;
  const lockDay = window.lockAt.toISOString().slice(0, 10);
  const deadlineDay = window.deadlineAt.toISOString().slice(0, 10);
  // With a start time, an event that began after the contract's last change counts even on the lock day
  // (a game 10 min after recording); one that began before it — or before a late fix — never does.
  // Sports matches only (startTimeCounts); the start must agree with the event date (±1 day for time zones).
  const start = draft.eventStart ? Date.parse(draft.eventStart) : NaN;
  if (window.startTimeCounts && draft.sourceKind === 'web' && !Number.isNaN(start) && nearDate(start, draft.eventDate)) {
    return start > window.lockAt.getTime() - CONTRACT_SET_BEFORE_LOCK_MS && start <= window.deadlineAt.getTime();
  }
  // A daily close happens at the end of its day, so the lock day's close is after lock (price-evidence.ts).
  const afterLock = draft.sourceKind === 'price_feed' ? draft.eventDate >= lockDay : draft.eventDate > lockDay;
  return afterLock && draft.eventDate <= deadlineDay;
}

function nearDate(startMs: number, eventDate: string): boolean {
  const day = Date.parse(`${eventDate}T00:00:00Z`);
  return startMs >= day - DAY_MS && startMs < day + 2 * DAY_MS;
}
const DAY_MS = 24 * 60 * 60 * 1000;

// Copies count once: same site, a near-identical page, or the same original report (e.g. one AP story).
function sameStory(a: EvidenceDraft, b: EvidenceDraft): boolean {
  const hostA = a.url ? hostOf(a.url) : null;
  const hostB = b.url ? hostOf(b.url) : null;
  if (hostA && hostB && registrableDomain(hostA) === registrableDomain(hostB)) return true;
  if (nearDuplicate(a.simhash, b.simhash)) return true;
  const origin = (s: string | null) => s?.trim().toLowerCase() || null;
  return !!origin(a.originalSource) && origin(a.originalSource) === origin(b.originalSource);
}
