// The daily owner-written post (spec 002 US2): the next item of the queue, posted as it was written.
// No AI touches these, and the queue is ours, so its text is the one text we do store (constitution V).
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { feedPosts, feedQueue } from '../db/schema.js';
import { log } from '../log.js';
import { alert, captureError } from '../observe.js';
import { HAND_RUN_SLOTS, type ContentDeps, type RunOptions } from './pool-run.js';
import { markPosted, recordPostFailure, reserveSlot, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost } from './spend.js';
import { X_POST_CREATE_USD } from '../x/prices.js';
import { blockedSlugs } from './claim-guard.js';

// `image`: an event post's poster (005 FR-024); a failed upload still posts the text.
export type OriginalDeps = ContentDeps & {
  postText: (text: string, image?: Buffer) => Promise<{ id: string }>;
};

export type OriginalRunResult =
  | { done: 'empty_queue' | 'cap_reached' | 'failed' }
  | { done: 'logged' | 'posted'; itemId: string; postedId?: string };

export async function runOriginalPost(
  deps: OriginalDeps,
  now: Date,
  options: RunOptions = {},
): Promise<OriginalRunResult> {
  if (!options.force && (await overSpendCap(deps, now)))
    return { done: 'cap_reached' };
  const today = utcDay(now);
  await retireMissed(deps, now, today);
  if (now.getUTCDay() === 5) await alertQuietWeek(deps, now);
  const item = await nextItem(deps, now, today);

  if (!item) {
    // Nothing queued for today is normal: the bot's event posts fill free days (005 FR-010).
    log('info', 'no own post queued for today', { event: 'feed.queue_empty' });
    return { done: 'empty_queue' };
  }

  const day = utcDay(now);
  if (deps.dryRun) {
    // Nothing is written: a queue item is identified by its id, so any row at all — even a dry-run one —
    // would retire the item for good and the owner's own writing would never go out.
    log('info', 'feed dry run: would post the next original', {
      event: 'feed.dry_run_original',
      item_id: item.id,
    });
    return { done: 'logged', itemId: item.id };
  }

  const slot = await reserveSlot(
    deps.db,
    { kind: 'original', day, queueItemId: item.id },
    options.force ? HAND_RUN_SLOTS : 0,
  );
  if (!slot) {
    log('info', 'no original posted: the day is used or the item is already out', {
      event: 'feed.no_slot_original',
      item_id: item.id,
    });
    return { done: 'cap_reached' };
  }

  let postedId: string;
  try {
    postedId = (await deps.postText(item.text)).id;
  } catch (error) {
    await recordPostFailure(deps.db, slot.id, error); // never sent → this queued post is not spent
    captureError(error, { event: 'feed.original_failed', item_id: item.id });
    return { done: 'failed' };
  }
  // The item is marked as posted even if this throws afterwards: the row stays reserved, so the item
  // keeps its slot and is never posted twice (its unique key is the queue item).
  await markPosted(deps.db, slot.id, postedId);
  await recordFeedPost(deps, X_POST_CREATE_USD);
  await deps.db
    .update(feedQueue)
    .set({ postedAt: now })
    .where(eq(feedQueue.id, item.id));
  log('info', 'own post published', {
    event: 'feed.original_posted',
    item_id: item.id,
    posted_id: postedId,
  });
  return { done: 'posted', itemId: item.id, postedId };
}

// Not posted, not retired, never reserved: a crash that lost the mark must not block the queue (its feed_posts
// row keeps it from going out twice).
const open = () =>
  and(
    isNull(feedQueue.postedAt),
    isNull(feedQueue.missedAt),
    sql`not exists (select 1 from ${feedPosts} where ${feedPosts.queueItemId} = ${feedQueue.id})`,
  );

// A dated post whose day passed unposted is retired and alerted once, however long the server was down (FR-008).
async function retireMissed(
  deps: OriginalDeps,
  now: Date,
  today: string,
): Promise<void> {
  const missed = await deps.db
    .update(feedQueue)
    .set({ missedAt: now })
    .where(and(open(), lt(feedQueue.postOn, today)))
    .returning({ id: feedQueue.id, postOn: feedQueue.postOn });
  for (const item of missed) {
    alert('feed.dated_missed', {
      item_id: item.id,
      post_on: item.postOn,
      message: 'a dated own post missed its day; never posted late',
    });
  }
}

// Today's dated post first, else the first undated one. One that may not go out is retired with an alert, so it
// alerts once and never blocks the queue: an event checked over 7 days before its date (FR-008a), or a post
// naming a claim whose author is not on the list (FR-014a).
async function nextItem(
  deps: OriginalDeps,
  now: Date,
  today: string,
): Promise<{ id: string; text: string } | null> {
  for (;;) {
    const [item] = await deps.db
      .select({
        id: feedQueue.id,
        text: feedQueue.text,
        postOn: feedQueue.postOn,
        sourceUrl: feedQueue.sourceUrl,
        checkedOn: feedQueue.checkedOn,
      })
      .from(feedQueue)
      .where(and(open(), or(eq(feedQueue.postOn, today), isNull(feedQueue.postOn))))
      .orderBy(sql`${feedQueue.postOn} is null`, asc(feedQueue.position))
      .limit(1);
    if (!item) return null;
    const reason = heldReason(item) ?? (await claimHeld(deps, item.text));
    if (!reason) return item;
    await deps.db
      .update(feedQueue)
      .set({ missedAt: now })
      .where(eq(feedQueue.id, item.id));
    alert(reason.event, { item_id: item.id, ...reason.detail });
  }
}

const DAY_MS = 86_400_000;

function heldReason(item: {
  postOn: string | null;
  sourceUrl: string | null;
  checkedOn: string | null;
}) {
  if (!item.sourceUrl || !item.postOn || !item.checkedOn) return null;
  const age = (Date.parse(item.postOn) - Date.parse(item.checkedOn)) / DAY_MS;
  return age > 7
    ? {
        event: 'feed.radar_stale',
        detail: { post_on: item.postOn, checked_on: item.checkedOn },
      }
    : null;
}

async function claimHeld(deps: OriginalDeps, text: string) {
  const blocked = await blockedSlugs(deps.db, text, deps.showAuthorIds ?? []);
  return blocked.length > 0
    ? { event: 'feed.claim_held', detail: { slugs: blocked } }
    : null;
}

// Fridays: one alert if fewer than three own posts went out in the past 7 days (FR-010). An empty queue alone
// alerts nothing.
async function alertQuietWeek(deps: OriginalDeps, now: Date): Promise<void> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [row] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(feedPosts)
    .where(
      and(
        eq(feedPosts.status, 'posted'),
        inArray(feedPosts.kind, ['original', 'digest', 'record', 'event']),
        gte(feedPosts.day, utcDay(since)),
      ),
    );
  const posted = row?.n ?? 0;
  if (posted < 3)
    alert('feed.quiet_week', {
      posted,
      message: 'fewer than three own posts went out this week',
    });
}
