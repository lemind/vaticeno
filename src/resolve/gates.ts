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
  url: string | null;
  retrievedAt: Date;
  quoteFound: boolean | null; // computed in memory from the page (or replayed); null = no quote given
  isFinalResult: boolean;
  originalSource: string | null; // who first reported it, if the page credits one
  simhash: string | null; // near-duplicate fingerprint of the page text
};

export type GateName = 'trusted' | 'quote_found' | 'in_window' | 'final' | 'independent';
export type Gates = Record<GateName, boolean | null>; // null = not applicable

export type Window = { lockAt: Date; deadlineAt: Date; absenceIsMeaningful: boolean };

export function runGates(draft: EvidenceDraft, window: Window, accepted: readonly EvidenceDraft[]): { gates: Gates; passed: boolean } {
  const isPrice = draft.sourceKind === 'price_feed';
  const gates: Gates = {
    trusted: draft.trustLevel !== 'other',
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
// deadline, and only from a source the contract marks exhaustive.
function inWindow(draft: EvidenceDraft, window: Window): boolean {
  if (draft.basis === 'absence') {
    return window.absenceIsMeaningful && draft.says === 'miss' && draft.retrievedAt.getTime() >= window.deadlineAt.getTime();
  }
  if (!draft.eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(draft.eventDate)) return false;
  const lockDay = window.lockAt.toISOString().slice(0, 10);
  const deadlineDay = window.deadlineAt.toISOString().slice(0, 10);
  // A daily close happens at the end of its day, so the lock day's close is after lock (price-evidence.ts).
  const afterLock = draft.sourceKind === 'price_feed' ? draft.eventDate >= lockDay : draft.eventDate > lockDay;
  return afterLock && draft.eventDate <= deadlineDay;
}

// Copies count once: same site, a near-identical page, or the same original report (e.g. one AP story).
function sameStory(a: EvidenceDraft, b: EvidenceDraft): boolean {
  const hostA = a.url ? hostOf(a.url) : null;
  const hostB = b.url ? hostOf(b.url) : null;
  if (hostA && hostB && registrableDomain(hostA) === registrableDomain(hostB)) return true;
  if (nearDuplicate(a.simhash, b.simhash)) return true;
  const origin = (s: string | null) => s?.trim().toLowerCase() || null;
  return !!origin(a.originalSource) && origin(a.originalSource) === origin(b.originalSource);
}
