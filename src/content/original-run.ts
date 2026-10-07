// The daily owner-written post (spec 002 US2): the next item of the queue, posted as it was written.
// No AI touches these, and the queue is ours, so its text is the one text we do store (constitution V).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { feedPosts, feedQueue } from '../db/schema.js';
import { log } from '../log.js';
import { PostNotSent } from '../x/client.js';
import { alert, captureError } from '../observe.js';
import { HAND_RUN_SLOTS, type ContentDeps, type RunOptions } from './pool-run.js';
import { markFailed, markPosted, releaseSlot, reserveSlot, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost } from './spend.js';
import { X_POST_CREATE_USD } from '../x/prices.js';

export type OriginalDeps = ContentDeps & { postText: (text: string) => Promise<{ id: string }> };

export type OriginalRunResult =
  | { done: 'empty_queue' | 'cap_reached' | 'failed' }
  | { done: 'logged' | 'posted'; itemId: string; postedId?: string };

export async function runOriginalPost(deps: OriginalDeps, now: Date, options: RunOptions = {}): Promise<OriginalRunResult> {
  if (!options.force && await overSpendCap(deps, now)) return { done: 'cap_reached' };
  // The next item that is neither marked as posted nor already recorded in feed_posts. The second check
  // matters: if a crash lost the mark after a post went out, that item must not block the whole queue
  // (its row keeps it from being posted again, so without this the feed would go quiet for good).
  const [item] = await deps.db
    .select({ id: feedQueue.id, text: feedQueue.text })
    .from(feedQueue)
    .where(and(isNull(feedQueue.postedAt), sql`not exists (select 1 from ${feedPosts} where ${feedPosts.queueItemId} = ${feedQueue.id})`))
    .orderBy(asc(feedQueue.position))
    .limit(1);

  if (!item) {
    // Nothing queued: the feed goes quiet until the owner writes more (the job runs once a day).
    alert('feed.queue_empty', { message: 'the originals queue is empty: no own post today' });
    return { done: 'empty_queue' };
  }

  const day = utcDay(now);
  if (deps.dryRun) {
    // Nothing is written: a queue item is identified by its id, so any row at all — even a dry-run one —
    // would retire the item for good and the owner's own writing would never go out.
    log('info', 'feed dry run: would post the next original', { event: 'feed.dry_run_original', item_id: item.id });
    return { done: 'logged', itemId: item.id };
  }

  const slot = await reserveSlot(deps.db, { kind: 'original', day, queueItemId: item.id }, options.force ? HAND_RUN_SLOTS : 0);
  if (!slot) {
    log('info', 'no original posted: the day is used or the item is already out', { event: 'feed.no_slot_original', item_id: item.id });
    return { done: 'cap_reached' };
  }

  let postedId: string;
  try {
    postedId = (await deps.postText(item.text)).id;
  } catch (error) {
    // Never sent → the reservation goes, so this queued post is not spent on a token fault.
    if (error instanceof PostNotSent) await releaseSlot(deps.db, slot.id);
    else await markFailed(deps.db, slot.id);
    captureError(error, { event: 'feed.original_failed', item_id: item.id });
    return { done: 'failed' };
  }
  // The item is marked as posted even if this throws afterwards: the row stays reserved, so the item
  // keeps its slot and is never posted twice (its unique key is the queue item).
  await markPosted(deps.db, slot.id, postedId);
  await recordFeedPost(deps, X_POST_CREATE_USD);
  await deps.db.update(feedQueue).set({ postedAt: now }).where(eq(feedQueue.id, item.id));
  log('info', 'own post published', { event: 'feed.original_posted', item_id: item.id, posted_id: postedId });
  return { done: 'posted', itemId: item.id, postedId };
}
