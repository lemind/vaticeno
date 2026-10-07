// The daily caps and "never the same post twice" (spec 002 FR-005), enforced by the database, not by
// code checks: a row is inserted BEFORE the post goes out, and a second insert simply loses.
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { FEED_COST_OPERATIONS, costEvents, feedPosts } from '../db/schema.js';

export type FeedKind = 'repost' | 'quote' | 'original' | 'receipt';

export type Reservation = {
  kind: FeedKind;
  day: string; // UTC date, YYYY-MM-DD
  sourcePostId?: string; // the post we repost, quote, or the verdict reply a receipt quotes
  accountId?: string; // the pool account (pool kinds only)
  queueItemId?: string; // the owner's queue item (originals only)
};

// Daily caps per cap group (reposts and quote posts share the pool group).
export const FEED_CAPS = { pool: 2, original: 1, receipt: 2 } as const;

export const capGroupOf = (kind: FeedKind): keyof typeof FEED_CAPS =>
  (kind === 'repost' || kind === 'quote' ? 'pool' : kind);

export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

// Takes the first free slot of the day, or returns null: the cap is reached, or this source post is
// already used (by an earlier run, or by another run inserting at the same moment).
// `extraSlots` is the hand-run allowance: `content:tick` is the owner asking for a post now, so the
// day's cap steps aside. "Never the same post twice" does not: that one is X's rule, not ours.
export async function reserveSlot(db: Db, reservation: Reservation, extraSlots = 0): Promise<{ id: string; slot: number } | null> {
  const cap = FEED_CAPS[capGroupOf(reservation.kind)] + extraSlots;
  for (let slot = 1; slot <= cap; slot++) {
    const [row] = await db
      .insert(feedPosts)
      .values({
        kind: reservation.kind,
        day: reservation.day,
        slot,
        sourcePostId: reservation.sourcePostId ?? null,
        accountId: reservation.accountId ?? null,
        queueItemId: reservation.queueItemId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: feedPosts.id, slot: feedPosts.slot });
    if (row?.slot != null) return { id: row.id, slot: row.slot };
  }
  return null;
}

// The post went out. `postedId` is null for a repost: X returns no id for one. Only a reserved row
// moves: a second mark (a retry, or an error path after the post already went out) changes nothing.
export async function markPosted(db: Db, id: string, postedId: string | null): Promise<boolean> {
  const rows = await db
    .update(feedPosts)
    .set({ status: 'posted', postedId })
    .where(and(eq(feedPosts.id, id), eq(feedPosts.status, 'reserved')))
    .returning({ id: feedPosts.id });
  return rows.length > 0;
}

// X refused the post: never retried (the source stays used), but the day's slot is freed. Guarded the
// same way, so an error raised *after* a successful post can never free a slot that was really used.
// The post never left the machine (PostNotSent): the reservation is deleted rather than marked failed, so
// neither the day's slot nor the source post is spent — a token fault must not burn an owner-written post
// (live defect 2026-10-06/07). Only ever called when X provably never saw the request.
export async function releaseSlot(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(feedPosts).where(and(eq(feedPosts.id, id), eq(feedPosts.status, 'reserved'))).returning({ id: feedPosts.id });
  return rows.length > 0;
}

export async function markFailed(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(feedPosts)
    .set({ status: 'failed', slot: null })
    .where(and(eq(feedPosts.id, id), eq(feedPosts.status, 'reserved')))
    .returning({ id: feedPosts.id });
  return rows.length > 0;
}

// A dry-run pick (FR-007): recorded for the owner's review and so the rehearsal behaves like the real
// thing — the same account never comes up twice in a row, the same post is never picked twice — while
// holding no slot of the day's cap. Returns null if that post was already picked.
export async function logDryRun(db: Db, reservation: Reservation): Promise<{ id: string } | null> {
  const [row] = await db
    .insert(feedPosts)
    .values({
      kind: reservation.kind,
      status: 'dry_run',
      day: reservation.day,
      slot: null,
      sourcePostId: reservation.sourcePostId ?? null,
      accountId: reservation.accountId ?? null,
      queueItemId: reservation.queueItemId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: feedPosts.id });
  return row ?? null;
}

// Which of these post ids we have already used (any status, any day): never the same post twice.
export async function usedPostIds(db: Db, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ sourcePostId: feedPosts.sourcePostId })
    .from(feedPosts)
    .where(inArray(feedPosts.sourcePostId, [...ids]));
  return new Set(rows.map((row) => row.sourcePostId).filter((id): id is string => id !== null));
}

// The pool account of the last run, dry or live: the next run must not pick it again (FR-002).
export async function previousAccountId(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ accountId: feedPosts.accountId })
    .from(feedPosts)
    .where(inArray(feedPosts.kind, ['repost', 'quote']))
    .orderBy(desc(feedPosts.createdAt))
    .limit(1);
  return row?.accountId ?? null;
}

// What the content jobs have spent today, from their own cost rows (FR-008).
export async function feedSpentTodayUsd(db: Db, now: Date): Promise<number> {
  const since = new Date(`${utcDay(now)}T00:00:00Z`);
  const [row] = await db
    .select({ usd: sql<string>`coalesce(sum(${costEvents.usdCost}), 0)` })
    .from(costEvents)
    .where(and(gte(costEvents.createdAt, since), inArray(costEvents.operation, [...FEED_COST_OPERATIONS])));
  return Number(row?.usd ?? 0);
}
