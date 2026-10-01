// FR-003: after every proposal these checks — not the proposal — decide the outcome. Pure.
import type { REJECT_REASONS } from '../db/schema.js';
import type { Proposal, UnclearItem } from './proposal.js';
import { type Contract, ContractSchema, SCHEDULED_EVENT_KINDS } from './schema.js';

export type RejectReason = (typeof REJECT_REASONS)[number];

export type CheckOutcome =
  | { outcome: 'recorded'; contract: Contract }
  | { outcome: 'needs_info'; unclear: UnclearItem[] }
  | { outcome: 'rejected'; reason: RejectReason };

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_DELAY_MS = 15 * 60 * 1000; // = lifecycle LOCK_DELAY_MS: the claim locks 15 min after recording
const MAX_YEARS = 10;

export function runChecks(proposal: Proposal, now: Date, options: { sourcePostClaimed: boolean }): CheckOutcome {
  if (!proposal.is_prediction) return { outcome: 'rejected', reason: 'not_prediction' };
  if (!proposal.x_rules_ok) return { outcome: 'rejected', reason: 'x_rules' };

  // Explicit deadline (MVP: stated by the author, never derived from an event).
  const contract = proposal.contract;
  if (!contract || proposal.unclear.includes('deadline')) {
    return { outcome: 'needs_info', unclear: withItem(proposal.unclear, 'deadline') };
  }

  const deadline = new Date(contract.deadline_at);
  if (Number.isNaN(deadline.getTime())) return { outcome: 'needs_info', unclear: withItem(proposal.unclear, 'deadline') };
  // More than 24 h (today's price or trend is already visible). A sports match only needs to end after the
  // lock: the evidence gate then checks it began after the claim was set (a game 10 min away is fine).
  const minLeadMs = SCHEDULED_EVENT_KINDS.includes(contract.source?.kind) ? LOCK_DELAY_MS : DAY_MS;
  if (deadline.getTime() - now.getTime() <= minLeadMs) return { outcome: 'rejected', reason: 'deadline_too_close' };
  if (deadline.getTime() > addYears(now, MAX_YEARS).getTime()) return { outcome: 'rejected', reason: 'deadline_too_far' };

  if (proposal.unclear.length > 0) return { outcome: 'needs_info', unclear: [...proposal.unclear] };

  // Objectively decidable, structured source, negative condition, price terms iff price feed:
  // enforced by the contract schema (a proposal may reach us unvalidated, e.g. in tests).
  const valid = ContractSchema.safeParse(contract);
  if (!valid.success) return { outcome: 'needs_info', unclear: unclearFromSchema(valid.error.issues) };

  if (options.sourcePostClaimed) return { outcome: 'rejected', reason: 'duplicate' };
  return { outcome: 'recorded', contract: valid.data };
}

function withItem(items: readonly UnclearItem[], item: UnclearItem): UnclearItem[] {
  return items.includes(item) ? [...items] : [...items, item];
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

// Map a schema failure to what the author would have to clarify.
function unclearFromSchema(issues: readonly { path: readonly PropertyKey[] }[]): UnclearItem[] {
  const items = new Set<UnclearItem>();
  for (const issue of issues) {
    const [head] = issue.path;
    if (head === 'source') items.add('source');
    else if (head === 'price') items.add('threshold');
    else if (head === 'subject') items.add('subject');
    else items.add('success_condition');
  }
  return [...items];
}
