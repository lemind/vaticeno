// One site is one witness, but the best page of it (004 FR-005, FR-006). Independence is decided here,
// after every page has been judged and gated on its own — not page by page against whatever was accepted
// first, which is how a meeting's landing page outranked the page naming the race (owner report 2026-10-12).
import type { EventMatch } from './relevance.js';
import { nearDuplicate } from './similarity.js';
import { hostOf, registrableDomain, type TrustLevel } from './trust.js';

// What grouping needs to know about one page that passed its own gates. Deliberately not the draft: this
// file decides by placement and completeness, and must never see a verdict it could prefer.
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

// Index-aligned: true where this page counts as its group's witness. Order-independent — the same set in
// any order gives the same answer (SC-002), because groups are built and ranked from the facts, not the order.
export function independenceOf(facts: readonly GroupFacts[]): boolean[] {
  const order = facts.map((_, i) => i).sort((a, b) => key(facts[a]!).localeCompare(key(facts[b]!)));
  // Matching is not transitive — A shares a domain with B, B shares a wire story with C, A and C share
  // nothing — so a page joins every group it matches and those groups merge. Keeping only the first match
  // would leave one story counted twice, which is what this rule exists to prevent.
  let groups: number[][] = [];
  for (const index of order) {
    const matched = groups.filter((group) => group.some((other) => sameStory(facts[index]!, facts[other]!)));
    groups = groups.filter((group) => !matched.includes(group));
    groups.push([...matched.flat(), index]);
  }

  const independent = facts.map(() => false);
  for (const group of groups) {
    // A disagreement inside one source is never hidden by choosing a representative (FR-008a): both pages go
    // through and the arbiter decides. "Placed" is the contract's own event, or a contract with nothing to
    // match — which is most of them. A page that could not be placed never escalates anything.
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
