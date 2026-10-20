// What the deployed escrow allows, as the bot and the wager page need it (docs/decisions/002-escrow-v1.md).
// The contract enforces all of it again; these only decide what to offer and what to say.
import type { WagerReplyKind } from '../db/schema.js';

const HOUR_MS = 3_600_000;
export const ACCEPTANCE_CLOSES_MS = 24 * HOUR_MS; // before the deadline
export const OFFER_LIFETIME_MS = 7 * 24 * HOUR_MS;
export const SETTLEMENT_WINDOW_MS = 72 * HOUR_MS;
export const TIMEOUT_MS = 14 * 24 * HOUR_MS; // after the deadline, if never settled

export type WagerClaim = {
  status: string;
  resolutionMethod: string | null;
  deadlineAt: Date | null;
};

// The one answer to "can this claim be wagered now", checked in FR-038's order: a claim that can never be
// wagered is never told it will open.
export function wagerKind(claim: WagerClaim, now: Date): WagerReplyKind {
  if (claim.resolutionMethod !== 'price_feed' || !claim.deadlineAt)
    return 'not_price';
  if (claim.status === 'draft') return 'not_locked';
  if (claim.status !== 'locked') return 'closed';
  return now.getTime() < wageringClosesAt(claim.deadlineAt).getTime()
    ? 'link'
    : 'closed';
}

export const wageringClosesAt = (deadline: Date) =>
  new Date(deadline.getTime() - ACCEPTANCE_CLOSES_MS);
