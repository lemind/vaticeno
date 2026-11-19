// The daily verdict repost (spec 005 FR-014b, constitution VI 2.10.0): one of our own verdict replies a day,
// reposted plainly, only for an author on FEED_SHOW_AUTHOR_IDS. Newest first, outcome-blind: misses go out too.
import { and, desc, eq, gte, inArray, isNotNull, notExists } from 'drizzle-orm';
import { claims, corrections, feedPosts, optOuts } from '../db/schema.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import { X_REPOST_USD } from '../x/prices.js';
import type { ContentDeps } from './pool-run.js';
import { markPosted, recordPostFailure, reserveSlot, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost } from './spend.js';

export type VerdictRunResult =
  | { done: 'spend_cap' | 'nothing_new' | 'cap_reached' | 'failed' }
  | { done: 'logged' | 'posted'; slug: string };

// A verdict older than this is old news: it is never reposted.
const WINDOW_MS = 7 * 86_400_000;

export async function runVerdictRepost(
  deps: ContentDeps,
  now: Date,
): Promise<VerdictRunResult> {
  if (await overSpendCap(deps, now)) return { done: 'spend_cap' };
  const shown = deps.showAuthorIds ?? [];
  if (shown.length === 0) return { done: 'nothing_new' };

  // Never a corrected verdict (the reply on X says what it was, 001 FR-035), never an author who sent STOP.
  const [pick] = await deps.db
    .select({ slug: claims.slug, replyId: claims.verdictReplyTweetId })
    .from(claims)
    .where(
      and(
        inArray(claims.authorXUserId, [...shown]),
        isNotNull(claims.verdictReplyTweetId),
        gte(claims.verdictReplyAt, new Date(now.getTime() - WINDOW_MS)),
        notExists(
          deps.db
            .select({ id: corrections.id })
            .from(corrections)
            .where(eq(corrections.claimId, claims.id)),
        ),
        notExists(
          deps.db
            .select({ id: optOuts.xUserId })
            .from(optOuts)
            .where(eq(optOuts.xUserId, claims.authorXUserId)),
        ),
        notExists(
          deps.db
            .select({ id: feedPosts.id })
            .from(feedPosts)
            .where(eq(feedPosts.sourcePostId, claims.verdictReplyTweetId)),
        ),
      ),
    )
    .orderBy(desc(claims.verdictReplyAt), desc(claims.slug))
    .limit(1);
  if (!pick?.replyId) return { done: 'nothing_new' }; // replyId is never null here; the check narrows its type

  if (deps.dryRun) {
    log('info', 'feed dry run: would repost a verdict', {
      event: 'feed.dry_run_verdict',
      slug: pick.slug,
      post_id: pick.replyId,
    });
    return { done: 'logged', slug: pick.slug };
  }

  // Reserved before posting, never retried (INIT_SPEC §6.7); the receipt slot is one a day.
  const slot = await reserveSlot(deps.db, {
    kind: 'receipt',
    day: utcDay(now),
    sourcePostId: pick.replyId,
  });
  if (!slot) return { done: 'cap_reached' };
  try {
    await deps.repost(pick.replyId);
  } catch (error) {
    await recordPostFailure(deps.db, slot.id, error);
    captureError(error, { event: 'feed.verdict_failed', slug: pick.slug });
    return { done: 'failed' };
  }
  await markPosted(deps.db, slot.id, null);
  await recordFeedPost(deps, X_REPOST_USD);
  log('info', 'verdict reposted', {
    event: 'feed.verdict_posted',
    slug: pick.slug,
    post_id: pick.replyId,
  });
  return { done: 'posted', slug: pick.slug };
}
