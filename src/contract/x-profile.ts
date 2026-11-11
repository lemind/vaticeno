// Follower-count predictions on X: the account comes from the post text, never from the contract, which
// said "author" for the account the post replied to (004 T419).
import type { CallCost } from '../llm/client.js';
import { SourceUnavailable } from '../resolve/fetch.js';
import { X_USER_READ_USD } from '../x/prices.js';
import { type Contract, ContractSchema, X_PROFILE_KIND } from './schema.js';

const X_HOSTS = /(^|\.)(x|twitter)\.com$/i;
const X_NAMES = /^(x|x\.com|twitter|twitter\.com)$/i;
const FOLLOWERS = /(\d[\d,.]*)\s*([km])?\+?\s*followers?\b/i; // "1000+ followers", "1k follower"
// A profile URL names its account: x.com/Bhoomi1021, never x.com/i/… or a status (004 T432).
const PROFILE_PATH = /^\/(\w{1,15})\/?$/;
const NOT_HANDLES = /^(i|home|search|explore|intent|share|author)$/i;
const BELOW = /\b(below|under|fewer than|less than)\b/i;
// "won't reach 500 followers" is a call that the count stays below 500, not that it gets there (kzhj7, 004 T435).
const NEGATED =
  /\b(not|never|cannot|wont|cant|dont|doesnt|isnt|fails? to|want(?!\s+to\b))\b|n['’]t\b/i; // "want reach" is a misspelt won't
const HANDLE = /@(\w{1,15})\b/g;
const FIRST_PERSON = /\b(i|i'll|i'm|i will|my|me|mine)\b/i;

export type FollowerAccount =
  { kind: 'poster' } | { kind: 'unnamed' } | { kind: 'handle'; handle: string };
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

// Whose count the post predicts: the last @handle before "N followers", the poster when it speaks in the
// first person, `unnamed` when it names nobody. Null when there is no follower phrase.
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
  if (!last)
    return FIRST_PERSON.test(before) ? { kind: 'poster' } : { kind: 'unnamed' };
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
  const below = BELOW.test(contract.criterion) || NEGATED.test(contract.criterion);
  const count = threshold.toLocaleString('en-US');
  // A named account is said by name: the model's "Author" read as the poster or the bot (2m7px, 004 T431).
  const named = handle
    ? {
        subject: `@${handle}'s X account`,
        criterion: below
          ? `@${handle} has fewer than ${count} followers on X`
          : `@${handle} reaches ${count} followers on X`,
        negative_condition: below
          ? `@${handle} has ${count} or more followers at the deadline`
          : `@${handle} has fewer than ${count} followers at the deadline`,
      }
    : {};
  const candidate = {
    ...contract,
    ...named,
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
      comparison: below ? ('BELOW' as const) : ('AT_LEAST' as const),
      threshold,
    },
  };
  const valid = ContractSchema.safeParse(candidate);
  return valid.success ? valid.data : contract;
}

// The handle in the source's profile URL (x.com/Bhoomi1021, x.com/intent/user?screen_name=gusto), or null.
export function profileHandle(contract: Contract): string | null {
  try {
    const url = new URL(contract.source.locator);
    if (!X_HOSTS.test(url.hostname)) return null;
    const handle =
      url.pathname.replace(/\/$/, '') === '/intent/user'
        ? url.searchParams.get('screen_name') // cgc9k's form
        : PROFILE_PATH.exec(url.pathname)?.[1];
    return handle && /^\w{1,15}$/.test(handle) && !NOT_HANDLES.test(handle)
      ? handle
      : null;
  } catch {
    return null;
  }
}

async function lookUpHandle(
  x: UserLookup,
  handle: string,
  costs: CallCost[],
): Promise<{ id: string; username: string }> {
  const user = await x.getUserByUsername(handle);
  costs.push({
    provider: 'x',
    operation: 'fetch',
    units: 1,
    usdCost: X_USER_READ_USD,
  });
  return user;
}

// Resolved to a real account, or the contract unchanged when it is not certain (unknown handle, no X
// client, no account anywhere). The post names it; when the post names nobody or the prediction came from the
// thread (ymjep), the profile the source names does (004 T432).
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
  if (account?.kind === 'poster')
    return asFollowerContract(contract, posterId, null);
  const handle =
    account?.kind === 'handle' ? account.handle : profileHandle(contract);
  if (!handle)
    return account?.kind === 'unnamed'
      ? asFollowerContract(contract, posterId, null)
      : contract;
  if (!x) return contract;
  try {
    const user = await lookUpHandle(x, handle, costs);
    return asFollowerContract(contract, user.id, user.username);
  } catch {
    return contract;
  }
}

// A follower claim locked as a web claim, its account in the source's profile URL: read as an X follower
// count, in memory only (INIT_SPEC §4). A failed lookup is an outage, never a web search (004 T432).
export async function followerReadFromProfile(
  x: UserLookup | undefined,
  contract: Contract,
  costs: CallCost[],
): Promise<Contract> {
  if (contract.followers || !isFollowerPrediction(contract)) return contract;
  const handle = profileHandle(contract);
  if (!handle) return contract;
  if (!x) throw new SourceUnavailable('no X client configured for follower counts');
  let user: { id: string; username: string };
  try {
    user = await lookUpHandle(x, handle, costs);
  } catch (error) {
    throw new SourceUnavailable('X handle lookup failed', { cause: error });
  }
  return asFollowerContract(contract, user.id, user.username);
}
