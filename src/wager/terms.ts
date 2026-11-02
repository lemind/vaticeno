// "Can this claim be wagered now", one answer for the bot and the wager page (003 FR-038). The contract
// enforces everything again; this only decides what to offer and what to say.
import type { WagerReplyKind } from '../db/schema.js';

export type WagerClaim = {
  status: string;
  resolutionMethod: string | null;
  deadlineAt: Date | null;
  // The claim's settlement row, written at lock: no row means the worker will never sign it.
  outbox: { authorizedUntil: Date | null } | null;
};

// Checked in FR-038's order, so a claim that can never be wagered is never told it will open.
export function wagerKind(claim: WagerClaim, now: Date): WagerReplyKind {
  // Any claim with a deadline can carry a stake (owner, 2026-11-02; FR-031a); `not_price` is only "no deadline".
  if (!claim.deadlineAt) return 'not_price';
  if (claim.status === 'draft') return 'not_locked';
  // No row: the bot writes one when asked, so here it means acceptance had already closed (src/bot/wager.ts).
  if (claim.status !== 'locked' || !claim.outbox) return 'closed';
  const closes = claim.outbox.authorizedUntil;
  // Not signed yet: the worker signs within a minute of lock, and only while acceptance is open.
  return !closes || now < closes ? 'link' : 'closed';
}
