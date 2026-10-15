// Follower-count predictions on X: the account comes from the post text, never from the contract, which
// said "author" for the account the post replied to (004 T419).
import type { CallCost } from '../llm/client.js';
import { X_USER_READ_USD } from '../x/prices.js';
import { type Contract, ContractSchema, X_PROFILE_KIND } from './schema.js';

const X_HOSTS = /(^|\.)(x|twitter)\.com$/i;
const X_NAMES = /^(x|x\.com|twitter|twitter\.com)$/i;
const FOLLOWERS = /(\d[\d,.]*)\s*([km])?\s+followers\b/i;
const BELOW = /\b(below|under|fewer than|less than)\b/i;
const HANDLE = /@(\w{1,15})\b/g;
const FIRST_PERSON = /\b(i|i'll|i'm|i will|my|me|mine)\b/i;

export type FollowerAccount =
  { kind: 'poster' } | { kind: 'handle'; handle: string };
export type UserLookup = {
  getUserByUsername(username: string): Promise<{ id: string; username: string }>;
};

function isXSource(contract: Contract): boolean {
  if (X_NAMES.test(contract.source.name.trim())) return true;
  try {
    return X_HOSTS.test(new URL(contract.source.locator).hostname);
  } catch {
    return false;
  }
}

// "3,000" → 3000, "3.5k" → 3500, "2m" → 2000000; anything else → null.
export function parseCount(
  digits: string,
  suffix: string | undefined,
): number | null {
  const scale =
    suffix?.toLowerCase() === 'k'
      ? 1_000
      : suffix?.toLowerCase() === 'm'
        ? 1_000_000
        : 1;
  const parsed = Number(digits.replace(/,/g, ''));
  const value = scale === 1 ? parsed : Math.round(parsed * scale); // 1.1 × 1000 is not 1100 in floating point
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isFollowerPrediction(contract: Contract): boolean {
  const match = FOLLOWERS.exec(contract.criterion);
  return (
    contract.resolution_method === 'model' &&
    !contract.price &&
    isXSource(contract) &&
    match !== null &&
    parseCount(match[1]!, match[2]) !== null
  );
}

// Whose count the post predicts: the last @handle before "N followers", or the poster when it names
// nobody or speaks in the first person. Null when there is no follower phrase.
export function followerAccount(
  text: string,
  botHandle: string,
): FollowerAccount | null {
  const phrase = FOLLOWERS.exec(text);
  if (!phrase) return null;
  const before = text.slice(0, phrase.index);
  const handles = [...before.matchAll(HANDLE)].filter(
    (m) => m[1]!.toLowerCase() !== botHandle.toLowerCase(),
  );
  const last = handles.at(-1);
  if (!last) return { kind: 'poster' };
  const between = before.slice(last.index! + last[0].length);
  return FIRST_PERSON.test(between)
    ? { kind: 'poster' }
    : { kind: 'handle', handle: last[1]! };
}

// The contract as a read of `userId`'s follower count; unchanged if the result is not a valid contract.
function asFollowerContract(
  contract: Contract,
  userId: string,
  handle: string | null,
): Contract {
  const match = FOLLOWERS.exec(contract.criterion);
  const threshold = match ? parseCount(match[1]!, match[2]) : null;
  if (threshold === null || !/^\d{1,25}$/.test(userId)) return contract;
  const candidate = {
    ...contract,
    source: {
      ...contract.source,
      kind: X_PROFILE_KIND,
      name: 'X profile',
      locator: `https://x.com/i/user/${userId}`,
      entity_id: `x_user:${userId}`,
      scope: handle
        ? `The follower count on @${handle}'s X profile.`
        : "The follower count on the poster's X profile.",
    },
    followers: {
      user_id: userId,
      comparison: BELOW.test(contract.criterion)
        ? ('BELOW' as const)
        : ('AT_LEAST' as const),
      threshold,
    },
  };
  const valid = ContractSchema.safeParse(candidate);
  return valid.success ? valid.data : contract;
}

// Resolved to a real account, or the contract unchanged when it is not certain (unknown handle, no X
// client, no follower phrase). A handle lookup is paid and recorded.
export async function resolveFollowerContract(
  x: UserLookup | undefined,
  botHandle: string,
  contract: Contract,
  postText: string,
  posterId: string,
  costs: CallCost[],
): Promise<Contract> {
  if (!isFollowerPrediction(contract)) return contract;
  const account = followerAccount(postText, botHandle);
  if (!account) return contract;
  if (account.kind === 'poster') return asFollowerContract(contract, posterId, null);
  if (!x) return contract;
  try {
    const user = await x.getUserByUsername(account.handle);
    costs.push({
      provider: 'x',
      operation: 'fetch',
      units: 1,
      usdCost: X_USER_READ_USD,
    });
    return asFollowerContract(contract, user.id, user.username);
  } catch {
    return contract;
  }
}
