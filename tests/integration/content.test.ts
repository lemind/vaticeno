// The feed's daily caps and "never the same post twice" (spec 002 FR-005): the database decides, so two
// runs at once, a refused post and a crash all end well.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { recordCost } from '../../src/db/costs.js';
import { feedSpentTodayUsd, logDryRun, markFailed, markPosted, previousAccountId, reserveSlot, utcDay } from '../../src/content/slots.js';
import { setupTestDb, type TestDb } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const NOW = new Date('2027-01-01T09:00:00Z');
const DAY = utcDay(NOW);
const pool = (sourcePostId: string) => ({ kind: 'repost' as const, day: DAY, sourcePostId, accountId: 'acc1' });

test('two runs reserving the same post at once: one wins, and it is never reserved again', async () => {
  const [first, second] = await Promise.all([reserveSlot(t.db, pool('p1')), reserveSlot(t.db, pool('p1'))]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(await reserveSlot(t.db, pool('p1')), null);
  const rows = await t.sql`select count(*)::int as n from feed_posts where source_post_id = 'p1'`;
  assert.equal(rows[0]!.n, 1);
});

test('the daily cap holds: two pool posts, and reposts and quote posts share it', async () => {
  assert.equal((await reserveSlot(t.db, pool('p1')))?.slot, 1);
  assert.equal((await reserveSlot(t.db, { kind: 'quote', day: DAY, sourcePostId: 'p2', accountId: 'acc2' }))?.slot, 2);
  assert.equal(await reserveSlot(t.db, pool('p3')), null);
  // A different day starts fresh.
  assert.equal((await reserveSlot(t.db, { ...pool('p4'), day: '2027-01-02' }))?.slot, 1);
});

test('a post X refused frees its slot but is never retried', async () => {
  const refused = await reserveSlot(t.db, pool('p1'));
  await markFailed(t.db, refused!.id);
  // The slot is free again…
  assert.equal((await reserveSlot(t.db, pool('p2')))?.slot, 1);
  // …but that source post is used up.
  assert.equal(await reserveSlot(t.db, pool('p1')), null);
});

test('a crash after posting keeps the slot taken, so nothing is posted twice', async () => {
  const reserved = await reserveSlot(t.db, pool('p1'));
  assert.equal(reserved?.slot, 1);
  // No mark at all (the process died): slot 1 stays taken, only slot 2 is left.
  assert.equal((await reserveSlot(t.db, pool('p2')))?.slot, 2);
  assert.equal(await reserveSlot(t.db, pool('p3')), null);
});

test('a posted repost keeps no post id of ours, a quote post does', async () => {
  const reposted = await reserveSlot(t.db, pool('p1'));
  await markPosted(t.db, reposted!.id, null);
  const quoted = await reserveSlot(t.db, { kind: 'quote', day: DAY, sourcePostId: 'p2', accountId: 'acc2' });
  await markPosted(t.db, quoted!.id, 'own99');
  const rows = await t.sql`select kind, status, posted_id, cap_group from feed_posts order by slot`;
  assert.deepEqual(rows.map((r) => [r.kind, r.status, r.posted_id, r.cap_group]), [
    ['repost', 'posted', null, 'pool'],
    ['quote', 'posted', 'own99', 'pool'],
  ]);
});

test('a dry-run pick holds no slot, but is not picked again, and names the previous account', async () => {
  assert.ok(await logDryRun(t.db, pool('p1')));
  assert.equal(await logDryRun(t.db, pool('p1')), null, 'the same post is never picked twice');
  assert.equal(await previousAccountId(t.db), 'acc1');
  // The whole day's cap is still free: a dry run spends nothing.
  assert.equal((await reserveSlot(t.db, { ...pool('p2'), accountId: 'acc2' }))?.slot, 1);
  assert.equal((await reserveSlot(t.db, { ...pool('p3'), accountId: 'acc3' }))?.slot, 2);
  assert.equal(await previousAccountId(t.db), 'acc3');
});

test("the daily spend counts the feed's own costs only", async () => {
  // Cost rows are stamped by the database, so this one test runs against the real clock.
  const today = new Date();
  await recordCost(t.db, { claimId: null, provider: 'x', operation: 'feed_read', units: 5, usdCost: 0.025 });
  await recordCost(t.db, { claimId: null, provider: 'x', operation: 'feed_post', usdCost: 0.015 });
  await recordCost(t.db, { claimId: null, provider: 'gemini', operation: 'normalize', usdCost: 0.5 });
  assert.equal(await feedSpentTodayUsd(t.db, today), 0.04);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(await feedSpentTodayUsd(t.db, tomorrow), 0, "yesterday's spend never counts");
});
