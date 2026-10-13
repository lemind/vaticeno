// One site is one witness, but the best page of it (004 FR-005, FR-006): independence is decided here,
// after every page has been judged on its own, never against whatever was accepted first.
import type { EventMatch } from './relevance.js';
import { nearDuplicate } from './similarity.js';
import { hostOf, registrableDomain, type TrustLevel } from './trust.js';

// What grouping needs about a page that passed its own gates — never a verdict it could prefer (FR-006).
export type GroupFacts = {
  url: string | null;
  simhash: string | null;
  originalSource: string | null; // the outlet the page credits, if any
  trustLevel: TrustLevel;
  eventMatch: EventMatch | null;
  says: string;
  detail: number; // how much this page pins down: its result line, event date and identity fields
};

const TRUST_RANK: Record<TrustLevel, number> = { primary: 0, established: 1, weak: 2 };
const MATCH_RANK: Record<string, number> = { yes: 0, not_applicable: 1, unknown: 2, no: 3 };

// Index-aligned: true where this page speaks for its group. Order-independent (004 SC-002).
export function independenceOf(facts: readonly GroupFacts[]): boolean[] {
  const order = facts.map((_, i) => i).sort((a, b) => key(facts[a]!).localeCompare(key(facts[b]!)));
  // Matching is not transitive (a domain, then a wire story), so a page joins every group it matches and
  // they merge; keeping only the first left one story counted twice (review 2026-10-13).
  let groups: number[][] = [];
  for (const index of order) {
    const matched = groups.filter((group) => group.some((other) => sameStory(facts[index]!, facts[other]!)));
    groups = groups.filter((group) => !matched.includes(group));
    groups.push([...matched.flat(), index]);
  }

  const independent = facts.map(() => false);
  for (const group of groups) {
    // A disagreement inside one source goes to the arbiter, not to a representative (FR-008a). Placed: the
    // contract's own event, or a contract with nothing to match against.
    const placed = group.filter((i) => facts[i]!.eventMatch === 'yes' || facts[i]!.eventMatch === 'not_applicable' || facts[i]!.eventMatch === null);
    const split = placed.length > 1 && placed.some((i) => facts[i]!.says !== facts[placed[0]!]!.says);
    if (split) {
      for (const i of placed) independent[i] = true;
      continue;
    }
    const best = [...group].sort((a, b) => rank(facts[a]!, facts[b]!))[0]!;
    independent[best] = true;
  }
  return independent;
}

// Event match first, then how much the page pins down, then trust. What the page SAYS is never a criterion.
function rank(a: GroupFacts, b: GroupFacts): number {
  const match = (MATCH_RANK[a.eventMatch ?? 'not_applicable'] ?? 9) - (MATCH_RANK[b.eventMatch ?? 'not_applicable'] ?? 9);
  if (match !== 0) return match;
  if (a.detail !== b.detail) return b.detail - a.detail;
  if (TRUST_RANK[a.trustLevel] !== TRUST_RANK[b.trustLevel]) return TRUST_RANK[a.trustLevel] - TRUST_RANK[b.trustLevel];
  return key(a).localeCompare(key(b)); // deterministic last resort, so the answer never depends on order
}

const key = (facts: GroupFacts) => facts.url ?? facts.simhash ?? facts.originalSource ?? '';

// Copies count once: the same site, a near-identical page, or the same original report (e.g. one AP story).
export function sameStory(a: GroupFacts, b: GroupFacts): boolean {
  const hostA = a.url ? hostOf(a.url) : null;
  const hostB = b.url ? hostOf(b.url) : null;
  if (hostA && hostB && registrableDomain(hostA) === registrableDomain(hostB)) return true;
  if (nearDuplicate(a.simhash, b.simhash)) return true;
  const origin = (s: string | null) => s?.trim().toLowerCase() || null;
  return !!origin(a.originalSource) && origin(a.originalSource) === origin(b.originalSource);
}
