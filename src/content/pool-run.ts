// The pool run (spec 002 US1): twice a day, one account from the pool, one of its posts, reposted — or
// quoted with a line of our own 1 time in 10. Dry-run by default: the pick is recorded, nothing is posted.
// Nothing of anyone else's post is stored, only ids (constitution V).
import { log } from '../log.js';
import { alert, captureError } from '../observe.js';
import { XApiError, type UserPost } from '../x/client.js';
import { X_POST_READ_USD, X_POST_CREATE_USD, X_REPOST_USD } from '../x/prices.js';
import { latestEligible } from './eligible.js';
import { type PoolAccount, pickAccount, poolAccounts } from './pool.js';
import { type QuoteDeps, type QuoteMode, ourLineFor } from './quote.js';
import { logDryRun, markFailed, markPosted, previousAccountId, reserveSlot, usedPostIds, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost, recordFeedRead } from './spend.js';

export type ContentDeps = QuoteDeps & {
  readPosts: (accountId: string) => Promise<UserPost[]>;
  repost: (postId: string) => Promise<boolean>;
  quotePost: (postId: string, text: string) => Promise<{ id: string }>;
  dryRun: boolean;
  dailyUsdCap: number;
  platformAccountId?: string;
  random?: () => number;
};

// 9 runs in 10 repost plainly; the rest split evenly between a sourced quote and a joke (FR-003/FR-004).
const REPOST_SHARE = 0.9;
export const HAND_RUN_SLOTS = 10; // room for a hand-run on top of the day's cap
const MAX_TRIES = 3;

export type PoolRunResult =
  | { done: 'spend_cap' | 'no_candidate' | 'cap_reached' }
  | { done: 'logged'; account: string; postId: string; mode: 'repost' | QuoteMode }
  | { done: 'posted'; account: string; postId: string; kind: 'repost' | 'quote'; postedId: string | null };

export type RunOptions = { force?: boolean }; // a hand-run: past the day's caps, by the owner's choice

export async function runPoolPost(deps: ContentDeps, now: Date, options: RunOptions = {}): Promise<PoolRunResult> {
  const random = deps.random ?? Math.random;
  if (!options.force && await overSpendCap(deps, now)) return { done: 'spend_cap' };

  const found = await findCandidate(deps, now, random);
  if (!found) return { done: 'no_candidate' };
  const { account, post } = found;

  // The roll decides before anything is reserved, because a quote turn needs its line first.
  const mode: 'repost' | QuoteMode = random() < REPOST_SHARE ? 'repost' : (random() < 0.5 ? 'quote' : 'joke');
  const ourLine = mode === 'repost' ? null : await ourLineFor(deps, post.text, mode);
  const kind = ourLine ? 'quote' : 'repost';
  const day = utcDay(now);

  if (deps.dryRun) {
    const row = await logDryRun(deps.db, { kind, day, sourcePostId: post.id, accountId: account.id });
    log('info', 'feed dry run: would post', {
      event: 'feed.dry_run', handle: account.handle, account_id: account.id, post_id: post.id, kind, mode, our_line: ourLine ?? null, recorded: Boolean(row),
    });
    return { done: 'logged', account: account.handle, postId: post.id, mode };
  }

  // Reserved before posting, and never retried afterwards (INIT_SPEC §6.7).
  const slot = await reserveSlot(deps.db, { kind, day, sourcePostId: post.id, accountId: account.id }, options.force ? HAND_RUN_SLOTS : 0);
  if (!slot) {
    log('info', 'feed slot not reserved; nothing posted', { event: 'feed.no_slot', handle: account.handle, post_id: post.id, kind });
    return { done: 'cap_reached' };
  }

  // Only the call to X sits in the try: if the marking below fails, the row stays `reserved`, which keeps
  // the slot taken and the post unrepeatable. Freeing a slot after a successful post is the one mistake
  // that would put a third post out that day.
  let postedId: string | null = null;
  try {
    if (kind === 'quote') postedId = (await deps.quotePost(post.id, ourLine!)).id;
    else await deps.repost(post.id);
  } catch (error) {
    // One attempt per post: the slot is freed, the post stays used, nothing is retried.
    await markFailed(deps.db, slot.id);
    captureError(error, { event: 'feed.post_failed', handle: account.handle, post_id: post.id, kind });
    return { done: 'cap_reached' };
  }
  await markPosted(deps.db, slot.id, postedId);
  await recordFeedPost(deps, kind === 'quote' ? X_POST_CREATE_USD : X_REPOST_USD);
  log('info', 'feed posted', { event: 'feed.posted', handle: account.handle, account_id: account.id, post_id: post.id, kind, posted_id: postedId });
  return { done: 'posted', account: account.handle, postId: post.id, kind, postedId };
}

// Up to three accounts are tried: a quiet account, or one whose latest posts we have all used, costs a
// read and yields nothing.
async function findCandidate(deps: ContentDeps, now: Date, random: () => number): Promise<{ account: PoolAccount; post: UserPost } | null> {
  const accounts = poolAccounts(deps.platformAccountId);
  const previous = await previousAccountId(deps.db);
  const tried = new Set<string>();

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const account = pickAccount(accounts.filter((a) => !tried.has(a.id)), previous, random);
    if (!account) return null;
    tried.add(account.id);

    let posts: UserPost[];
    try {
      posts = await deps.readPosts(account.id);
    } catch (error) {
      // A renamed, suspended or protected account: skip it, say so once, keep the rest of the pool.
      if (error instanceof XApiError && error.status >= 400 && error.status < 500) {
        alert('feed.account_unreadable', { handle: account.handle, account_id: account.id, status: error.status });
        continue;
      }
      throw error; // an outage is not a verdict on the pool: fail the run and retry next slot
    }
    await recordFeedRead(deps, posts.length * X_POST_READ_USD, Math.max(posts.length, 1));

    const post = latestEligible(posts, now, await usedPostIds(deps.db, posts.map((p) => p.id)));
    if (post) return { account, post };
    log('info', 'no eligible post from this account', { event: 'feed.no_eligible', handle: account.handle, read: posts.length });
  }
  return null;
}

