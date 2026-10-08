// The owed-work sweep: every two hours it must name what was supposed to happen and did not.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { auditOwedWork } from '../../src/lifecycle/reconcile.js';
import { insertClaim, insertEvidence, setupTestDb, type TestDb } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const NOW = new Date('2026-10-07T12:00:00Z');
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

test('a quiet account owes nothing', async () => {
  assert.deepEqual(await auditOwedWork(t.db, NOW), { verdictsOwed: [], reservedPosts: 0, claimsNeverShown: [], resolverStuck: [] });
});

test('it names the verdict nobody was told, and ignores one still in flight', async () => {
  const owed = await insertClaim(t.sql, 'resolved', { verdict_reply_at: hoursAgo(5), verdict_reply_tweet_id: null });
  const justNow = await insertClaim(t.sql, 'resolved', { verdict_reply_at: hoursAgo(0), verdict_reply_tweet_id: null });
  const posted = await insertClaim(t.sql, 'resolved', { verdict_reply_at: hoursAgo(5), verdict_reply_tweet_id: 'v1' });
  for (const claim of [owed, justNow, posted]) {
    const evidence = await insertEvidence(t.sql, claim.id, { says: 'miss' });
    await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'final', outcome: 'miss', decided_by: 'evidence', deciding_evidence_id: evidence.id, decided_at: hoursAgo(6) })}`;
  }
  const result = await auditOwedWork(t.db, NOW);
  assert.deepEqual(result.verdictsOwed, [owed.slug], 'only the one past the in-flight hour, and only if unposted');
});

test('it names a claim its author was never shown, and a feed post stuck mid-flight', async () => {
  const unseen = await insertClaim(t.sql, 'draft', { lock_at: null, created_at: hoursAgo(3) });
  await insertClaim(t.sql, 'draft', { lock_at: hoursAgo(-1), created_at: hoursAgo(3) }); // a normal draft, still inside its window
  await insertClaim(t.sql, 'draft', { lock_at: null }); // withheld this minute: still settling, not alerted
  await t.sql`insert into feed_posts ${t.sql({ kind: 'repost', status: 'reserved', day: '2026-10-07', slot: 1, source_post_id: 'p1', account_id: 'acc1', created_at: hoursAgo(3) })}`;
  await t.sql`insert into feed_posts ${t.sql({ kind: 'receipt', status: 'reserved', day: '2026-10-07', slot: 1, source_post_id: 'p2', created_at: hoursAgo(0) })}`;

  const result = await auditOwedWork(t.db, NOW);
  assert.deepEqual(result.claimsNeverShown, [unseen.slug]);
  assert.equal(result.reservedPosts, 1, 'the one reserved for hours, not the one from this minute');
});

test('it names a claim the resolver has stopped getting to', async () => {
  const stuck = await insertClaim(t.sql, 'locked', { next_check_at: hoursAgo(4) });
  await insertClaim(t.sql, 'locked', { next_check_at: hoursAgo(-2) }); // due later today: not stuck
  assert.deepEqual((await auditOwedWork(t.db, NOW)).resolverStuck, [stuck.slug]);
});
