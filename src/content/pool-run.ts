// The pool run (spec 002 US1, spec 005 FR-011): once a day, one X search over the weekday's group of event
// accounts, the most-liked upcoming event reposted. Dry-run by default: the pick is recorded, nothing is posted.
// Nothing of anyone else's post is stored, only ids (constitution V).
import { log } from '../log.js';
import { captureError } from '../observe.js';
import type { SearchPost } from '../x/client.js';
import { X_POST_READ_USD, X_POST_CREATE_USD, X_REPOST_USD } from '../x/prices.js';
import { eligiblePosts } from './eligible.js';
import { upcomingEvents } from './repost-fit.js';
import { type RepostGroup, groupFor, groupQuery } from './repost-groups.js';
import { type QuoteDeps, type QuoteMode, ourLineFor } from './quote.js';
import {
  logDryRun,
  markPosted,
  recordPostFailure,
  reserveSlot,
  usedPostIds,
  utcDay,
} from './slots.js';
import { overSpendCap, recordFeedPost, recordFeedRead } from './spend.js';

export type ContentDeps = QuoteDeps & {
  searchPosts: (query: string, since: Date) => Promise<SearchPost[]>;
  repost: (postId: string) => Promise<boolean>;
  quotePost: (postId: string, text: string) => Promise<{ id: string }>;
  dryRun: boolean;
  dailyUsdCap: number;
  // Authors whose claims an own post may name (constitution VI 2.9.0); empty = none.
  showAuthorIds?: readonly string[];
  random?: () => number;
};

// HACK(x): OBSERVED 2026-10-05 — X answers 403 "You can only reply to or quote posts where you are
// mentioned or are the author" when quoting a pool account's post, so every pool run reposts plainly
// for now. Our own words still go out on our own posts (receipts quote our verdict replies, which we
// authored). `--mode quote|joke` still forces the attempt by hand.
// REVISIT: if X's access level changes (or a quote of a third party succeeds by hand), set this back
// to 0.9 and the 1-in-10 quote turn returns.
const REPOST_SHARE = 1;
export const HAND_RUN_SLOTS = 10; // room for a hand-run on top of the day's cap
const SEARCH_HOURS = 48; // eligiblePosts drops anything older anyway
// The day's group, then the next day's once; still nothing → no repost (FR-011).
const GROUP_OFFSETS = [0, 1];

export type PoolRunResult =
  | { done: 'spend_cap' | 'no_candidate' | 'cap_reached' }
  | { done: 'logged'; account: string; postId: string; mode: 'repost' | QuoteMode }
  | {
      done: 'posted';
      account: string;
      postId: string;
      kind: 'repost' | 'quote';
      postedId: string | null;
    };

// A hand-run: past the day's caps, by the owner's choice, and optionally one chosen kind of post
// instead of the 90/5/5 roll.
export type RunOptions = { force?: boolean; mode?: 'repost' | QuoteMode };

export async function runPoolPost(
  deps: ContentDeps,
  now: Date,
  options: RunOptions = {},
): Promise<PoolRunResult> {
  const random = deps.random ?? Math.random;
  if (!options.force && (await overSpendCap(deps, now)))
    return { done: 'spend_cap' };

  const found = await findCandidate(deps, now);
  if (!found) return { done: 'no_candidate' };
  const { group, post } = found;
  const account = { handle: group.name, id: post.author_id };

  // The roll decides before anything is reserved, because a quote turn needs its line first.
  const mode: 'repost' | QuoteMode =
    options.mode ??
    (random() < REPOST_SHARE ? 'repost' : random() < 0.5 ? 'quote' : 'joke');
  const ourLine = mode === 'repost' ? null : await ourLineFor(deps, post.text, mode);
  const kind = ourLine ? 'quote' : 'repost';
  const day = utcDay(now);

  if (deps.dryRun) {
    const row = await logDryRun(deps.db, {
      kind,
      day,
      sourcePostId: post.id,
      accountId: account.id,
    });
    log('info', 'feed dry run: would post', {
      event: 'feed.dry_run',
      handle: account.handle,
      account_id: account.id,
      post_id: post.id,
      kind,
      mode,
      our_line: ourLine ?? null,
      recorded: Boolean(row),
    });
    return { done: 'logged', account: account.handle, postId: post.id, mode };
  }

  // Reserved before posting, and never retried afterwards (INIT_SPEC §6.7).
  const slot = await reserveSlot(
    deps.db,
    { kind, day, sourcePostId: post.id, accountId: account.id },
    options.force ? HAND_RUN_SLOTS : 0,
  );
  if (!slot) {
    log('info', 'feed slot not reserved; nothing posted', {
      event: 'feed.no_slot',
      handle: account.handle,
      post_id: post.id,
      kind,
    });
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
    // One attempt per post: the slot is freed, the post stays used, nothing is retried — unless the
    // request never left the machine, when neither the slot nor the post is spent.
    await recordPostFailure(deps.db, slot.id, error);
    captureError(error, {
      event: 'feed.post_failed',
      handle: account.handle,
      post_id: post.id,
      kind,
    });
    return { done: 'cap_reached' };
  }
  await markPosted(deps.db, slot.id, postedId);
  await recordFeedPost(deps, kind === 'quote' ? X_POST_CREATE_USD : X_REPOST_USD);
  log('info', 'feed posted', {
    event: 'feed.posted',
    handle: account.handle,
    account_id: account.id,
    post_id: post.id,
    kind,
    posted_id: postedId,
  });
  return {
    done: 'posted',
    account: account.handle,
    postId: post.id,
    kind,
    postedId,
  };
}

// The day's group is searched; if no event comes back, the next day's group once (spec 005 FR-011).
async function findCandidate(
  deps: ContentDeps,
  now: Date,
): Promise<{ group: RepostGroup; post: SearchPost } | null> {
  for (const offset of GROUP_OFFSETS) {
    const group = groupFor(now, offset);
    const posts = await deps.searchPosts(
      groupQuery(group),
      new Date(now.getTime() - SEARCH_HOURS * 3_600_000),
    );
    await recordFeedRead(
      deps,
      posts.length * X_POST_READ_USD,
      Math.max(posts.length, 1),
    );
    const eligible = eligiblePosts(
      posts,
      now,
      await usedPostIds(
        deps.db,
        posts.map((p) => p.id),
      ),
    );
    const events = await upcomingEvents(deps, eligible);
    const best = events.sort((a, b) => engagement(b) - engagement(a))[0];
    if (best) return { group, post: best };
    log('info', 'no upcoming event in this group', {
      event: 'feed.no_event_post',
      group: group.name,
      read: posts.length,
      eligible: eligible.length,
    });
  }
  return null;
}

const engagement = (post: SearchPost) =>
  post.public_metrics.like_count + 2 * post.public_metrics.retweet_count;
