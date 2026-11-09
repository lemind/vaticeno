// The Monday digest and the Friday record post (spec 002 US4, spec 005 US4): read the record, write the text, and
// post it in the day's one own-post slot. One X post each, no AI call.
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { claims, feedPosts, resolutions } from '../db/schema.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import { X_POST_CREATE_USD } from '../x/prices.js';
import type { OriginalDeps } from './original-run.js';
import { deadlineDigest, recordPost, type WeekCounts } from './record-posts.js';
import { markPosted, recordPostFailure, reserveSlot, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost } from './spend.js';

export type RecordRunResult = {
  done: 'nothing_new' | 'cap_reached' | 'failed' | 'logged' | 'posted';
};

const WEEK_MS = 7 * 86_400_000;
// Claims that reached the record: locked, or judged since.
const ON_RECORD = ['locked', 'resolving', 'resolved', 'void'] as const;

export async function runDigest(
  deps: OriginalDeps,
  now: Date,
): Promise<RecordRunResult> {
  if (await overSpendCap(deps, now)) return { done: 'cap_reached' };
  // Only claims of authors on the list are named (constitution VI 2.9.0, 005 FR-014); an empty list names none.
  const shown = deps.showAuthorIds ?? [];
  if (shown.length === 0) return { done: 'nothing_new' };
  const due = await deps.db
    .select({ slug: claims.slug, deadlineAt: claims.deadlineAt })
    .from(claims)
    .where(
      and(
        eq(claims.status, 'locked'),
        inArray(claims.authorXUserId, [...shown]),
        gte(claims.deadlineAt, now),
        lte(claims.deadlineAt, new Date(now.getTime() + WEEK_MS)),
      ),
    );
  const recent = await deps.db
    .select({ payload: feedPosts.payload })
    .from(feedPosts)
    .where(
      and(
        eq(feedPosts.kind, 'digest'),
        gte(feedPosts.day, utcDay(new Date(now.getTime() - WEEK_MS))),
      ),
    );
  const named = new Set(
    recent.flatMap((r) => (r.payload as { slugs?: string[] } | null)?.slugs ?? []),
  );
  const digest = deadlineDigest(
    due.flatMap((c) =>
      c.deadlineAt ? [{ slug: c.slug, deadlineAt: c.deadlineAt }] : [],
    ),
    now,
    named,
  );
  if (!digest) return { done: 'nothing_new' };
  return publish(deps, now, 'digest', digest.text, { slugs: digest.slugs });
}

export async function runRecord(
  deps: OriginalDeps,
  now: Date,
): Promise<RecordRunResult> {
  if (await overSpendCap(deps, now)) return { done: 'cap_reached' };
  const counts = await weekCounts(deps, now);
  const [last] = await deps.db
    .select({ payload: feedPosts.payload })
    .from(feedPosts)
    .where(and(eq(feedPosts.kind, 'record'), eq(feedPosts.status, 'posted')))
    .orderBy(desc(feedPosts.createdAt))
    .limit(1);
  const text = recordPost(counts, (last?.payload as WeekCounts | undefined) ?? null);
  if (!text) return { done: 'nothing_new' };
  return publish(deps, now, 'record', text, counts);
}

async function weekCounts(deps: OriginalDeps, now: Date): Promise<WeekCounts> {
  const since = new Date(now.getTime() - WEEK_MS);
  const count = async (where: ReturnType<typeof and>) =>
    (
      await deps.db
        .select({ n: sql<number>`count(*)::int` })
        .from(claims)
        .where(where)
    )[0]?.n ?? 0;
  const verdicts = await deps.db
    .select({ outcome: resolutions.outcome, n: sql<number>`count(*)::int` })
    .from(resolutions)
    .where(
      and(
        eq(resolutions.reviewStatus, 'final'),
        gte(resolutions.decidedAt, since),
        lte(resolutions.decidedAt, now),
      ),
    )
    .groupBy(resolutions.outcome);
  const of = (outcome: string) =>
    verdicts.find((v) => v.outcome === outcome)?.n ?? 0;
  return {
    recorded: await count(
      and(
        inArray(claims.status, ON_RECORD),
        gte(claims.lockAt, since),
        lte(claims.lockAt, now),
      ),
    ),
    cameDue: await count(
      and(
        inArray(claims.status, ON_RECORD),
        gte(claims.deadlineAt, since),
        lte(claims.deadlineAt, now),
      ),
    ),
    hit: of('hit'),
    miss: of('miss'),
    void: of('void'),
    open: await count(inArray(claims.status, ['locked', 'resolving'])),
  };
}

// Reserved before posting and never retried (INIT_SPEC §6.7), in the day's own-post slot (005 FR-009).
async function publish(
  deps: OriginalDeps,
  now: Date,
  kind: 'digest' | 'record',
  text: string,
  payload: unknown,
): Promise<RecordRunResult> {
  if (deps.dryRun) {
    log('info', `feed dry run: would post the ${kind}`, {
      event: `feed.dry_run_${kind}`,
      chars: text.length,
    });
    return { done: 'logged' };
  }
  const slot = await reserveSlot(deps.db, { kind, day: utcDay(now), payload });
  if (!slot) return { done: 'cap_reached' };
  let postedId: string;
  try {
    postedId = (await deps.postText(text)).id;
  } catch (error) {
    await recordPostFailure(deps.db, slot.id, error);
    captureError(error, { event: `feed.${kind}_failed` });
    return { done: 'failed' };
  }
  await markPosted(deps.db, slot.id, postedId);
  await recordFeedPost(deps, X_POST_CREATE_USD);
  log('info', `${kind} posted`, {
    event: `feed.${kind}_posted`,
    posted_id: postedId,
  });
  return { done: 'posted' };
}
