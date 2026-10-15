// A verdict must not argue with its own evidence (004 FR-009): where code can apply the criterion to the
// page's own stated outcome, it does. Pure.
import type { Contract } from '../contract/schema.js';
import type { EventMatch } from './relevance.js';

// What the page stated as the outcome, in fields rather than prose.
export type ObservedResult = { winner: string | null; score: string | null } | null;

// Only the plainest shape: "<subject> wins/beats …". Anything with a margin or a threshold is a question
// about how much, which this cannot weigh and must not pretend to.
const WINS = /\b(?:wins?|beats?|defeats?)\b/i;
const QUALIFIED =
  /\bby\s+(?:\d|a|at least|more|over)|\bmargin\b|\bat least\b|\bor more\b|\bmore than\b|\bfewer than\b|\bwithout\b/i;
// "wins the/a <competition>" is a standing settled over a season, so one match's winner cannot answer
// it; "beats <opponent>" is a single result this can check (004 T426).
const STANDING = /\b(?:wins?|win)\s+(?:the|a|an)\s/i;

// true: the page's own facts agree with the verdict the judge gave it. false: they contradict it, so the
// page counts for nothing and someone is told. null: nothing here is code's to check.
export function selfConsistent(
  contract: Contract,
  says: string,
  observed: ObservedResult,
  match: EventMatch | null,
): boolean | null {
  if (says !== 'hit' && says !== 'miss') return null;
  // Another event's page cannot count; one code cannot place still answers about our claim (004 T423).
  if (match === 'no' || match === 'unknown') return null;
  if (!observed?.winner) return null;
  if (!WINS.test(contract.criterion) || QUALIFIED.test(contract.criterion))
    return null;
  if (STANDING.test(contract.criterion)) return null;
  if (!startsWithSubject(contract)) return null;

  const computed = names(observed.winner, contract.subject) ? 'hit' : 'miss';
  return computed === says;
}

// "Sunny Q wins Race 2" — the subject must be the one doing the winning, or "X beat Y" inverts the answer.
function startsWithSubject(contract: Contract): boolean {
  const before = contract.criterion.slice(0, contract.criterion.search(WINS));
  return names(before, contract.subject);
}

function names(a: string, b: string): boolean {
  const left = normalise(a);
  const right = normalise(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
