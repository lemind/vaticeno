import type { CLAIM_STATUSES } from '../db/schema.js';

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// Lifecycle table (spec "Lifecycle"). Must match the claims_status_transition trigger in
// drizzle/0001_triggers.sql — tests/integration/db.test.ts checks every pair against Postgres.
export const TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  parsing: ['draft', 'needs_info', 'rejected'],
  needs_info: ['draft', 'needs_info', 'expired'],
  draft: ['draft', 'locked', 'expired'],
  locked: ['resolving'],
  resolving: ['resolving', 'resolved', 'void'],
  resolved: [],
  void: [],
  rejected: [],
  expired: [],
};

export const TERMINAL_STATES: readonly ClaimStatus[] = ['rejected', 'expired', 'resolved', 'void'];
// States a claim is in once it has locked: its contract can never change again.
export const REACHED_LOCK: ReadonlySet<string> = new Set<ClaimStatus>(['locked', 'resolving', 'resolved', 'void']);

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// Early refusal with a clear message; the database trigger stays the authority.
export function assertTransition(from: ClaimStatus, to: ClaimStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`claim transition ${from} -> ${to} is not allowed`);
  }
}
