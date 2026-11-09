// The feed's daily caps and "never the same post twice" (spec 002 FR-005): the database decides, so two
// runs at once, a refused post and a crash all end well.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { recordCost } from '../../src/db/costs.js';
import {
  feedSpentTodayUsd,
  logDryRun,
  markFailed,
  markPosted,
  previousAccountId,
  releaseSlot,
  reserveSlot,
  utcDay,
} from '../../src/content/slots.js';
import { runPoolPost, type ContentDeps } from '../../src/content/pool-run.js';
import { runDigest } from '../../src/content/record-run.js';
import { type EventDeps, runEventPost } from '../../src/content/event-run.js';
import {
  runOriginalPost,
  type OriginalDeps,
} from '../../src/content/original-run.js';
import { XApiError, type UserPost } from '../../src/x/client.js';
import { insertClaim, insertEvidence, setupTestDb, type TestDb } from './helpers.js';

let t: TestDb;
before(async () => {
  t = await setupTestDb();
});
after(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.truncateAll();
});

const NOW = new Date('2027-01-01T09:00:00Z');
const DAY = utcDay(NOW);
const pool = (sourcePostId: string) => ({
  kind: 'repost' as const,
  day: DAY,
  sourcePostId,
  accountId: 'acc1',
});

test('two runs reserving the same post at once: one wins, and it is never reserved again', async () => {
  const [first, second] = await Promise.all([
    reserveSlot(t.db, pool('p1')),
    reserveSlot(t.db, pool('p1')),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(await reserveSlot(t.db, pool('p1')), null);
  const rows =
    await t.sql`select count(*)::int as n from feed_posts where source_post_id = 'p1'`;
  assert.equal(rows[0]!.n, 1);
});

test('the daily cap holds: one pool post, and reposts and quote posts share it', async () => {
  assert.equal((await reserveSlot(t.db, pool('p1')))?.slot, 1);
  assert.equal(
    await reserveSlot(t.db, {
      kind: 'quote',
      day: DAY,
      sourcePostId: 'p2',
      accountId: 'acc2',
    }),
    null,
  );
  // A different day starts fresh.
  assert.equal(
    (await reserveSlot(t.db, { ...pool('p4'), day: '2027-01-02' }))?.slot,
    1,
  );
});

test('a post X refused frees its slot but is never retried', async () => {
  const refused = await reserveSlot(t.db, pool('p1'));
  await markFailed(t.db, refused!.id);
  // The slot is free again…
  assert.equal((await reserveSlot(t.db, pool('p2')))?.slot, 1);
  // …but that source post is used up.
  assert.equal(await reserveSlot(t.db, pool('p1')), null);
});

// The live defect of 2026-10-06/07: the token file became unreadable, so posts that never left the
// machine still spent their slot and their source — an owner-written post was lost that way.
test('a post that never left the machine spends neither the slot nor the source', async () => {
  const neverSent = await reserveSlot(t.db, pool('p1'));
  assert.equal(await releaseSlot(t.db, neverSent!.id), true);
  // The day's slot is free again, and the post nobody ever saw can still be posted.
  assert.equal((await reserveSlot(t.db, pool('p1')))?.slot, 1);
  // A reservation already marked is never released: that post may have landed.
  const landed = await reserveSlot(t.db, {
    kind: 'receipt',
    day: DAY,
    sourcePostId: 'p9',
  });
  await markPosted(t.db, landed!.id, 'x1');
  assert.equal(await releaseSlot(t.db, landed!.id), false);
});

test('a crash after posting keeps the slot taken, so nothing is posted twice', async () => {
  const reserved = await reserveSlot(t.db, pool('p1'));
  assert.equal(reserved?.slot, 1);
  // No mark at all (the process died): the day's one slot stays taken.
  assert.equal(await reserveSlot(t.db, pool('p2')), null);
});

test('a posted repost keeps no post id of ours, a quote post does', async () => {
  const reposted = await reserveSlot(t.db, pool('p1'));
  await markPosted(t.db, reposted!.id, null);
  const quoted = await reserveSlot(t.db, {
    kind: 'quote',
    day: '2027-01-02',
    sourcePostId: 'p2',
    accountId: 'acc2',
  });
  await markPosted(t.db, quoted!.id, 'own99');
  const rows =
    await t.sql`select kind, status, posted_id, cap_group from feed_posts order by day`;
  assert.deepEqual(
    rows.map((r) => [r.kind, r.status, r.posted_id, r.cap_group]),
    [
      ['repost', 'posted', null, 'pool'],
      ['quote', 'posted', 'own99', 'pool'],
    ],
  );
});

test('a dry-run pick holds no slot, but is not picked again, and names the previous account', async () => {
  assert.ok(await logDryRun(t.db, pool('p1')));
  assert.equal(
    await logDryRun(t.db, pool('p1')),
    null,
    'the same post is never picked twice',
  );
  assert.equal(await previousAccountId(t.db), 'acc1');
  // The day's slot is still free: a dry run spends nothing.
  assert.equal(
    (await reserveSlot(t.db, { ...pool('p2'), accountId: 'acc2' }))?.slot,
    1,
  );
  assert.equal(await previousAccountId(t.db), 'acc2');
});

test('an error path after a successful post cannot free the slot or re-post', async () => {
  const live = await reserveSlot(t.db, pool('p1'));
  assert.equal(await markPosted(t.db, live!.id, null), true);
  // The post is out; whatever throws afterwards, this must change nothing.
  assert.equal(await markFailed(t.db, live!.id), false);
  assert.equal(
    await reserveSlot(t.db, { ...pool('p2'), accountId: 'acc2' }),
    null,
    'slot 1 stays used',
  );
  const [row] =
    await t.sql`select status, slot from feed_posts where id = ${live!.id}`;
  assert.deepEqual([row!.status, row!.slot], ['posted', 1]);
  // A dry-run row is not a reserved post either, so no mark touches it.
  const dry = await logDryRun(t.db, { ...pool('p3'), accountId: 'acc3' });
  assert.equal(await markPosted(t.db, dry!.id, 'x1'), false);
});

test('an owner-written original is reserved once, whatever the day', async () => {
  const [item] =
    await t.sql`insert into feed_queue ${t.sql({ text: 'On the record.', position: 1 })} returning id`;
  const queueItemId = item!.id as string;
  assert.equal(
    (await reserveSlot(t.db, { kind: 'original', day: DAY, queueItemId }))?.slot,
    1,
  );
  // A crash before feed_queue.posted_at was set must not post the same text again tomorrow.
  assert.equal(
    await reserveSlot(t.db, { kind: 'original', day: '2027-01-02', queueItemId }),
    null,
  );
});

test("the daily spend counts the feed's own costs only", async () => {
  // Cost rows are stamped by the database, so this one test runs against the real clock.
  const today = new Date();
  await recordCost(t.db, {
    claimId: null,
    provider: 'x',
    operation: 'feed_read',
    units: 5,
    usdCost: 0.025,
  });
  await recordCost(t.db, {
    claimId: null,
    provider: 'x',
    operation: 'feed_post',
    usdCost: 0.015,
  });
  await recordCost(t.db, {
    claimId: null,
    provider: 'gemini',
    operation: 'normalize',
    usdCost: 0.5,
  });
  assert.equal(await feedSpentTodayUsd(t.db, today), 0.04);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(
    await feedSpentTodayUsd(t.db, tomorrow),
    0,
    "yesterday's spend never counts",
  );
});

// The pool run end to end, with X and the model stubbed: a dry run records and posts nothing, a live run
// posts once and marks the row, and a refusal from X frees the slot without a retry.
function contentDeps(
  over: Partial<ContentDeps> & { posts?: UserPost[] } = {},
): ContentDeps {
  const posts = over.posts ?? [
    {
      id: 'src1',
      text: 'City will beat Arsenal on Sunday',
      created_at: NOW.toISOString(),
    },
  ];
  return {
    db: t.db,
    normalizerModel: 'stub',
    // The repost policy fits the first candidate; any other call gets our quote-turn line.
    llm: {
      generateJson: async ({
        instructionVersion,
      }: {
        instructionVersion: string;
      }) =>
        instructionVersion === 'repost.v1'
          ? {
              data: { posts: [{ index: 0, kind: 'event', fit: 8 }] },
              costs: [],
            }
          : { data: { line: 'That one is on the record now.' }, costs: [] },
    },
    quoteSource: async () => ({
      text: 'Prediction is very difficult.',
      by: 'Niels Bohr',
    }),
    readPosts: async () => posts,
    repost: async () => true,
    quotePost: async () => ({ id: 'own1' }),
    dryRun: true,
    dailyUsdCap: 0.15,
    platformAccountId: undefined,
    random: () => 0.5, // a plain repost
    ...over,
  } as unknown as ContentDeps;
}

test('a dry run records the pick, posts nothing, and holds no slot', async () => {
  const calls: string[] = [];
  const deps = contentDeps({
    repost: async () => {
      calls.push('repost');
      return true;
    },
  });
  const run = await runPoolPost(deps, NOW);
  assert.equal(run.done, 'logged');
  assert.deepEqual(calls, []);
  const [row] = await t.sql`select status, slot, source_post_id from feed_posts`;
  assert.deepEqual(
    [row!.status, row!.slot, row!.source_post_id],
    ['dry_run', null, 'src1'],
  );
  // The same post is not picked again, and the day's cap is untouched.
  assert.equal((await runPoolPost(deps, NOW)).done, 'no_candidate');
});

test('a live run reposts once, marks the row, and records the cost', async () => {
  const reposted: string[] = [];
  const deps = contentDeps({
    dryRun: false,
    repost: async (id: string) => {
      reposted.push(id);
      return true;
    },
  });
  const run = await runPoolPost(deps, NOW);
  assert.deepEqual([run.done, reposted], ['posted', ['src1']]);
  const [row] = await t.sql`select kind, status, slot, posted_id from feed_posts`;
  assert.deepEqual(
    [row!.kind, row!.status, row!.slot, row!.posted_id],
    ['repost', 'posted', 1, null],
  );
  const [cost] =
    await t.sql`select operation, units from cost_events where operation = 'feed_post'`;
  assert.equal(cost!.operation, 'feed_post');
  // Never the same post twice, even on a later day.
  assert.equal(
    (await runPoolPost(deps, new Date('2027-01-02T09:00:00Z'))).done,
    'no_candidate',
  );
});

test('the repost policy: nothing that fits is never reposted, and a fitting older post beats a newer one', async () => {
  const reposted: string[] = [];
  const sortCalls: number[] = [];
  const none = contentDeps({
    dryRun: false,
    repost: async (id: string) => {
      reposted.push(id);
      return true;
    },
    llm: {
      generateJson: async ({ input }: { input: string }) => {
        const { posts } = JSON.parse(input) as { posts: unknown[] };
        sortCalls.push(posts.length);
        return {
          data: {
            posts: posts.map((_, index) => ({ index, kind: 'none', fit: 1 })),
          },
          costs: [],
        };
      },
    },
  } as unknown as Partial<ContentDeps>);
  assert.equal((await runPoolPost(none, NOW)).done, 'no_candidate');
  assert.equal(reposted.length, 0);
  assert.equal(
    sortCalls.length,
    2,
    'one account, then one other, then the slot is skipped',
  );

  const older = new Date(NOW.getTime() - 3_600_000).toISOString();
  const picky = contentDeps({
    dryRun: false,
    posts: [
      {
        id: 'highlight',
        text: 'What a goal! Watch it again',
        created_at: NOW.toISOString(),
      },
      {
        id: 'call',
        text: 'The Champions League final is on 30 May in Budapest',
        created_at: older,
      },
    ],
    repost: async (id: string) => {
      reposted.push(id);
      return true;
    },
    llm: {
      generateJson: async () => ({
        data: {
          posts: [
            { index: 0, kind: 'prediction', fit: 10 },
            { index: 1, kind: 'event', fit: 7 },
          ],
        },
        costs: [],
      }),
    },
  } as unknown as Partial<ContentDeps>);
  assert.equal((await runPoolPost(picky, NOW)).done, 'posted');
  assert.deepEqual(reposted, ['call']);
});

test('a quote turn adds our own line, and X refusing it frees the slot without a retry', async () => {
  const quoted: Array<{ id: string; text: string }> = [];
  const deps = contentDeps({
    dryRun: false,
    quotePost: async (id, text) => {
      quoted.push({ id, text });
      return { id: 'own1' };
    },
  });
  const NEXT_DAY = new Date(NOW.getTime() + 86_400_000); // the quote took today's one slot
  // X refuses quoting a third party for now (REPOST_SHARE = 1), so the quote turn is asked for by hand.
  assert.equal((await runPoolPost(deps, NOW, { mode: 'joke' })).done, 'posted');
  assert.deepEqual(quoted, [{ id: 'src1', text: 'That one is on the record now.' }]);

  const refusing = contentDeps({
    dryRun: false,
    posts: [
      {
        id: 'src2',
        text: 'Another prediction by Friday',
        created_at: NEXT_DAY.toISOString(),
      },
    ],
    repost: async () => {
      throw new Error('duplicate content');
    },
  });
  assert.equal((await runPoolPost(refusing, NEXT_DAY)).done, 'cap_reached');
  const [failed] =
    await t.sql`select status, slot from feed_posts where source_post_id = 'src2'`;
  assert.deepEqual([failed!.status, failed!.slot], ['failed', null]);
});

test('a dry run of the daily own post leaves the queue alone', async () => {
  await t.sql`insert into feed_queue ${t.sql({ text: 'Dry run keeps this.', position: 1 })}`;
  const dry = originalDeps({
    dryRun: true,
    postText: async () => {
      throw new Error('must not post');
    },
  });
  assert.equal((await runOriginalPost(dry, NOW)).done, 'logged');
  assert.equal(
    (await t.sql`select count(*)::int as n from feed_posts`)[0]!.n,
    0,
    'nothing reserved',
  );
  // The item is still the next one to go out, for real this time.
  assert.equal((await runOriginalPost(originalDeps(), NOW)).done, 'posted');
});

test('the spend cap stops every job, not just the pool', async () => {
  await recordCost(t.db, {
    claimId: null,
    provider: 'x',
    operation: 'feed_read',
    units: 1,
    usdCost: 0.2,
  });
  await t.sql`insert into feed_queue ${t.sql({ text: 'Not today.', position: 1 })}`;
  const deps = originalDeps({
    dailyUsdCap: 0.15,
    postText: async () => {
      throw new Error('must not post');
    },
  });
  assert.equal((await runOriginalPost(deps, new Date())).done, 'cap_reached');
});

test('every posting job records what it spent', async () => {
  await t.sql`insert into feed_queue ${t.sql({ text: 'Costed post.', position: 1 })}`;
  const deps = originalDeps();
  await runOriginalPost(deps, NOW);
  await runPoolPost(contentDeps({ dryRun: false }), NOW);
  const rows =
    await t.sql`select operation, count(*)::int as n from cost_events group by operation order by operation`;
  const byOp = Object.fromEntries(rows.map((r) => [r.operation, r.n]));
  assert.equal(byOp['feed_post'], 2, 'the own post and the pool post');
  assert.ok((byOp['feed_read'] ?? 0) >= 1, 'the pool read');
});

test('the spend cap stops the day, and an unreadable account is skipped', async () => {
  await recordCost(t.db, {
    claimId: null,
    provider: 'x',
    operation: 'feed_read',
    units: 1,
    usdCost: 0.2,
  });
  const capped = await runPoolPost(contentDeps({ dailyUsdCap: 0.15 }), new Date());
  assert.equal(capped.done, 'spend_cap');

  const gone = contentDeps({
    readPosts: async () => {
      throw new XApiError(403, 'forbidden', null);
    },
  });
  assert.equal((await runPoolPost(gone, NOW)).done, 'no_candidate');
});

// The daily owner-written post (US2): in order, once each, and never twice even after a crash.
function originalDeps(over: Partial<OriginalDeps> = {}): OriginalDeps {
  const posted: string[] = [];
  return {
    ...contentDeps({ dryRun: false }),
    postText: async (text) => {
      posted.push(text);
      return { id: `own${posted.length}` };
    },
    ...over,
  } as OriginalDeps;
}

test('queued own posts go out one a day, in order, then the queue runs dry', async () => {
  const texts = [
    '"Soon" is not a deadline.',
    'Predictions fade. Records do not.',
    'Say it now.',
  ];
  for (const [i, text] of texts.entries())
    await t.sql`insert into feed_queue ${t.sql({ text, position: i + 1 })}`;
  const sent: string[] = [];
  const deps = originalDeps({
    postText: async (text) => {
      sent.push(text);
      return { id: `own${sent.length}` };
    },
  });

  for (const [i, day] of ['2027-01-01', '2027-01-02', '2027-01-03'].entries()) {
    const run = await runOriginalPost(deps, new Date(`${day}T13:41:00Z`));
    assert.equal(run.done, 'posted', `day ${i + 1}`);
  }
  assert.deepEqual(sent, texts);
  // A second run the same day is capped, and an empty queue just says so.
  assert.equal(
    (await runOriginalPost(deps, new Date('2027-01-03T18:00:00Z'))).done,
    'empty_queue',
  );
  const rows =
    await t.sql`select count(*)::int as n from feed_queue where posted_at is not null`;
  assert.equal(rows[0]!.n, 3);
});

test('a lost mark never republishes an own post, and never jams the queue', async () => {
  const [first] =
    await t.sql`insert into feed_queue ${t.sql({ text: 'On the record.', position: 1 })} returning id`;
  await t.sql`insert into feed_queue ${t.sql({ text: 'Second one.', position: 2 })}`;
  const sent: string[] = [];
  const deps = originalDeps({
    postText: async (text) => {
      sent.push(text);
      return { id: `own${sent.length}` };
    },
  });
  assert.equal((await runOriginalPost(deps, NOW)).done, 'posted');

  // A crash lost the mark on the queue item: its feed_posts row is the real record.
  await t.sql`update feed_queue set posted_at = null where id = ${first!.id}`;
  assert.equal(
    (await runOriginalPost(deps, new Date('2027-01-02T13:41:00Z'))).done,
    'posted',
  );
  assert.deepEqual(
    sent,
    ['On the record.', 'Second one.'],
    'the first post never went out twice',
  );
});

test('X refusing an own post frees the day and never retries it', async () => {
  await t.sql`insert into feed_queue ${t.sql({ text: 'Third one.', position: 1 })}`;
  const refusing = originalDeps({
    postText: async () => {
      throw new Error('duplicate content');
    },
  });
  assert.equal((await runOriginalPost(refusing, NOW)).done, 'failed');
  const [failed] =
    await t.sql`select status, slot from feed_posts where kind = 'original'`;
  assert.deepEqual([failed!.status, failed!.slot], ['failed', null]);
  // Its row still names the item, so the item is never attempted again.
  assert.equal(
    (await runOriginalPost(refusing, new Date('2027-01-02T13:41:00Z'))).done,
    'empty_queue',
  );
});

test('a hand-run posts even when the day is used up, but never the same thing twice', async () => {
  await t.sql`insert into feed_queue ${t.sql({ text: 'First today.', position: 1 })}`;
  await t.sql`insert into feed_queue ${t.sql({ text: 'Second today.', position: 2 })}`;
  const sent: string[] = [];
  const deps = originalDeps({
    postText: async (text) => {
      sent.push(text);
      return { id: `own${sent.length}` };
    },
  });

  assert.equal((await runOriginalPost(deps, NOW)).done, 'posted'); // the scheduler's one slot
  assert.equal((await runOriginalPost(deps, NOW)).done, 'cap_reached'); // the scheduler again: capped
  assert.equal((await runOriginalPost(deps, NOW, { force: true })).done, 'posted'); // the owner asked
  assert.deepEqual(sent, ['First today.', 'Second today.']);
  // Nothing is left to post, so even a forced run has nothing to say.
  assert.equal(
    (await runOriginalPost(deps, NOW, { force: true })).done,
    'empty_queue',
  );
});

// Spec 005 US3: the queue on a calendar. Alerts are log lines, so they are read back from stdout.
async function alertsDuring(run: () => Promise<unknown>): Promise<string[]> {
  const events: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const line = String(chunk);
    if (line.includes('"alert":true')) events.push(JSON.parse(line).event as string);
    return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = write;
  }
  return events;
}

const queue = (row: Record<string, unknown>) =>
  t.sql`insert into feed_queue ${t.sql(row)}`;

test("the queue: today's dated post first; a missed one retired once, even after days down", async () => {
  await queue({ text: 'Undated one.', position: 1 });
  await queue({ text: 'Dated for Tuesday.', position: 2, post_on: '2027-01-05' });
  await queue({
    text: 'Dated for a Sunday that passes.',
    position: 3,
    post_on: '2027-01-03',
  });
  const sent: string[] = [];
  const deps = originalDeps({
    postText: async (text) => {
      sent.push(text);
      return { id: `own${sent.length}` };
    },
  });

  // Tuesday, after two days down: the Sunday post is retired and alerted, Tuesday's goes ahead of the undated.
  const tuesday = await alertsDuring(() =>
    runOriginalPost(deps, new Date('2027-01-05T13:41:00Z')),
  );
  assert.deepEqual(sent, ['Dated for Tuesday.']);
  assert.deepEqual(tuesday.filter((e) => e === 'feed.dated_missed').length, 1);
  const wednesday = await alertsDuring(() =>
    runOriginalPost(deps, new Date('2027-01-06T13:41:00Z')),
  );
  assert.deepEqual(sent, ['Dated for Tuesday.', 'Undated one.']);
  assert.ok(!wednesday.includes('feed.dated_missed'), 'a missed post alerts once');
});

test('the queue: the digest takes the day; a stale event post and a claim off the list are held', async () => {
  await t.sql`insert into feed_posts ${t.sql({ kind: 'digest', day: '2027-01-04', slot: 1, status: 'posted', posted_id: 'd1' })}`;
  await queue({ text: 'Undated one.', position: 1 });
  const sent: string[] = [];
  const deps = originalDeps({
    showAuthorIds: ['200'],
    postText: async (text) => {
      sent.push(text);
      return { id: `own${sent.length}` };
    },
  });
  assert.equal(
    (await runOriginalPost(deps, new Date('2027-01-04T13:41:00Z'))).done,
    'cap_reached',
  );
  assert.deepEqual(sent, [], 'one own post a day, whichever kind');

  const theirs = await insertClaim(t.sql, 'locked', { author_x_user_id: '999' });
  await t.sql`delete from feed_queue`;
  await queue({
    text: 'Final scheduled for 12 Jan.',
    position: 2,
    post_on: '2027-01-12',
    source_url: 'https://example.org/final',
    checked_on: '2027-01-02',
  });
  await queue({ text: `Their call #${theirs.slug} is locked.`, position: 3 });
  await queue({ text: 'Undated two.', position: 4 });
  const held = await alertsDuring(() =>
    runOriginalPost(deps, new Date('2027-01-12T13:41:00Z')),
  );
  assert.deepEqual(sent, ['Undated two.']);
  assert.ok(held.includes('feed.radar_stale') && held.includes('feed.claim_held'));
});

test('the quiet-week alert: a Friday after two own posts alerts, after three it does not', async () => {
  const friday = new Date('2027-01-08T13:41:00Z');
  for (const [i, day] of ['2027-01-04', '2027-01-05'].entries())
    await t.sql`insert into feed_posts ${t.sql({ kind: 'event', day, slot: 1, status: 'posted', posted_id: `e${i}`, created_at: `${day}T15:00:00Z` })}`;
  const deps = originalDeps();
  assert.ok(
    (await alertsDuring(() => runOriginalPost(deps, friday))).includes(
      'feed.quiet_week',
    ),
  );
  await t.sql`insert into feed_posts ${t.sql({ kind: 'event', day: '2027-01-06', slot: 1, status: 'posted', posted_id: 'e3', created_at: '2027-01-06T15:00:00Z' })}`;
  assert.ok(
    !(await alertsDuring(() => runOriginalPost(deps, friday))).includes(
      'feed.quiet_week',
    ),
  );
});

test('the Monday digest: one a day, its slugs kept, and a dry run reserves nothing', async () => {
  const monday = new Date('2027-01-04T08:17:00Z');
  const claim = await insertClaim(t.sql, 'locked', {
    deadline_at: '2027-01-07T23:59:59Z',
  });
  const sent: string[] = [];
  const dry = originalDeps({ dryRun: true });
  assert.equal((await runDigest(dry, monday)).done, 'logged');
  assert.equal((await t.sql`select count(*)::int as n from feed_posts`)[0]!.n, 0);
  const deps = originalDeps({
    postText: async (text) => {
      sent.push(text);
      return { id: `d${sent.length}` };
    },
  });
  assert.equal((await runDigest(deps, monday)).done, 'posted');
  assert.match(sent[0]!, new RegExp(`#${claim.slug} · 7 Jan`));
  assert.equal(
    (await runDigest(deps, monday)).done,
    'nothing_new',
    'a slug is named once a week',
  );
  const [row] =
    await t.sql`select kind, payload from feed_posts where kind = 'digest'`;
  assert.deepEqual(row!.payload, { slugs: [claim.slug] });
});

// Spec 005 US3a: the bot's event post, with the search and the pages stubbed.
function eventDeps(
  answer: Record<string, unknown>,
  pages: Record<string, string>,
  over: Partial<EventDeps> = {},
): EventDeps & { searches: number[] } {
  const searches: number[] = [];
  const deps = {
    ...originalDeps(),
    llm: {
      groundedAnswer: async () => {
        searches.push(1);
        return { text: JSON.stringify(answer), urls: Object.keys(pages), costs: [] };
      },
      groundedSearch: async () => ({ queries: [], urls: [], costs: [] }),
    },
    fetchPage: async (url: string) => {
      if (!(url in pages)) throw new Error('unreadable');
      return { url, text: pages[url]! };
    },
    searches,
    ...over,
  };
  return deps as unknown as EventDeps & { searches: number[] };
}

const TUESDAY = new Date('2026-11-03T15:11:00Z');
const FOUND = {
  found: true,
  name: 'Crystal Palace vs Liverpool',
  date: '2026-11-08',
  place: 'Selhurst Park, London',
};
const TWO_SITES = {
  'https://www.bbc.co.uk/a': 'Crystal Palace v Liverpool, Sunday 8 November',
  'https://www.skysports.com/b': 'Crystal Palace vs Liverpool on Nov 8',
};

test('an event two sites confirm posts once from the template, and never again', async () => {
  const sent: string[] = [];
  const deps = eventDeps(FOUND, TWO_SITES, {
    postText: async (text: string) => {
      sent.push(text);
      return { id: `ev${sent.length}` };
    },
  } as Partial<EventDeps>);
  assert.equal((await runEventPost(deps, TUESDAY, () => 0)).done, 'posted');
  assert.match(
    sent[0]!,
    /^Crystal Palace vs Liverpool is scheduled for Sun 8 Nov at Selhurst Park, London\./,
  );
  const [row] = await t.sql`select payload from feed_posts where kind = 'event'`;
  assert.equal((row!.payload as { name: string }).name, FOUND.name);
  // Wednesday: the same event is skipped, and the slot of the day is free.
  assert.equal(
    (await runEventPost(deps, new Date('2026-11-04T15:11:00Z'), () => 0)).done,
    'no_event',
  );
  assert.equal(sent.length, 1);
});

test('one site, a date outside the window, or no event: nothing is posted after three topics', async () => {
  const oneSite = eventDeps(FOUND, {
    'https://www.bbc.co.uk/a': TWO_SITES['https://www.bbc.co.uk/a'],
  });
  assert.equal((await runEventPost(oneSite, TUESDAY, () => 0)).done, 'no_event');
  assert.equal(oneSite.searches.length, 3, 'three topics, then the day is skipped');
  const tooFar = eventDeps({ ...FOUND, date: '2026-11-30' }, TWO_SITES);
  assert.equal((await runEventPost(tooFar, TUESDAY, () => 0)).done, 'no_event');
  const none = eventDeps({ found: false }, {});
  assert.equal((await runEventPost(none, TUESDAY, () => 0)).done, 'no_event');
});

test('an answer without links: our own search finds the two pages', async () => {
  const deps = eventDeps(FOUND, TWO_SITES);
  const sourced = eventDeps(FOUND, {}, {
    llm: {
      groundedAnswer: async () => ({
        text: JSON.stringify(FOUND),
        urls: [],
        costs: [],
      }),
      groundedSearch: async () => ({
        queries: ['q'],
        urls: Object.keys(TWO_SITES),
        costs: [],
      }),
    },
    fetchPage: deps.fetchPage,
  } as unknown as Partial<EventDeps>);
  assert.equal((await runEventPost(sourced, TUESDAY, () => 0)).done, 'posted');
});

test('a day whose own-post slot is taken costs no search', async () => {
  await t.sql`insert into feed_posts ${t.sql({ kind: 'original', day: '2026-11-03', slot: 1, status: 'posted', posted_id: 'q1', queue_item_id: (await t.sql`insert into feed_queue ${t.sql({ text: 'Q', position: 1 })} returning id`)[0]!.id })}`;
  const deps = eventDeps(FOUND, TWO_SITES);
  assert.equal((await runEventPost(deps, TUESDAY, () => 0)).done, 'slot_taken');
  assert.equal(deps.searches.length, 0);
});

test('an event post carries its poster; a failed poster still posts the text', async () => {
  const sent: Array<{ text: string; image: boolean }> = [];
  const postText = async (text: string, image?: Buffer) => {
    sent.push({ text, image: Boolean(image) });
    return { id: `ev${sent.length}` };
  };
  const withPoster = eventDeps(FOUND, TWO_SITES, {
    postText,
    makePoster: async () => Buffer.from('png'),
  } as Partial<EventDeps>);
  assert.equal((await runEventPost(withPoster, TUESDAY, () => 0)).done, 'posted');
  await t.sql`delete from feed_posts`;
  const broken = eventDeps(FOUND, TWO_SITES, {
    postText,
    makePoster: async () => {
      throw new Error('image model down');
    },
  } as Partial<EventDeps>);
  assert.equal((await runEventPost(broken, TUESDAY, () => 0)).done, 'posted');
  assert.deepEqual(
    sent.map((s) => s.image),
    [true, false],
  );
});
