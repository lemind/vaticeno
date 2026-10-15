// Follower-count claims about the author's own X account (004 T419). The normalizer has no field for them
// and wrote the literal "author" as the account (claim gzrt3), so code recognises them and fills in the id.
import { type Contract, ContractSchema, X_PROFILE_KIND } from './schema.js';

const X_HOSTS = /(^|\.)(x|twitter)\.com$/i;
const X_NAMES = /^(x|x\.com|twitter|twitter\.com)$/i;
const FOLLOWERS = /(\d[\d,.]*)\s*([km])?\s+followers\b/i;
const BELOW = /\b(below|under|fewer than|less than)\b/i;
// The model writes the literal "author" as the account when it means the poster (gzrt3); a subject like
// "the author Stephen King" names someone else, so only the account field and a possessive subject count.
const AUTHOR_ENTITY = /^(the )?author$/i;
const AUTHOR_SUBJECT = /^(the )?author's\b/i;

function isXSource(contract: Contract): boolean {
  if (X_NAMES.test(contract.source.name.trim())) return true;
  try {
    return X_HOSTS.test(new URL(contract.source.locator).hostname);
  } catch {
    return false;
  }
}

// "3,000" → 3000, "3.5k" → 3500, "2m" → 2000000; anything else → null.
export function parseCount(digits: string, suffix: string | undefined): number | null {
  const scale = suffix?.toLowerCase() === 'k' ? 1_000 : suffix?.toLowerCase() === 'm' ? 1_000_000 : 1;
  const parsed = Number(digits.replace(/,/g, ''));
  const value = scale === 1 ? parsed : Math.round(parsed * scale); // 1.1 × 1000 is not 1100 in floating point
  return Number.isInteger(value) && value > 0 ? value : null;
}

// The contract unchanged unless it is a follower count on X about the author's own account.
export function asAuthorFollowerContract(contract: Contract, authorId: string): Contract {
  if (contract.resolution_method !== 'model' || contract.price || !isXSource(contract)) return contract;
  const match = FOLLOWERS.exec(contract.criterion);
  const threshold = match ? parseCount(match[1]!, match[2]) : null;
  const aboutAuthor = AUTHOR_ENTITY.test(contract.source.entity_id.trim()) || AUTHOR_SUBJECT.test(contract.subject.trim());
  if (threshold === null || !aboutAuthor || !/^\d{1,25}$/.test(authorId)) return contract;

  const candidate = {
    ...contract,
    source: {
      ...contract.source,
      kind: X_PROFILE_KIND,
      name: 'X profile',
      locator: `https://x.com/i/user/${authorId}`,
      entity_id: `x_user:${authorId}`,
      scope: 'The follower count on the author\'s X profile, read at the deadline.',
    },
    followers: { user_id: authorId, comparison: BELOW.test(contract.criterion) ? ('BELOW' as const) : ('AT_LEAST' as const), threshold },
  };
  const valid = ContractSchema.safeParse(candidate);
  return valid.success ? valid.data : contract;
}
