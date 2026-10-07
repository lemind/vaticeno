// Verdict replies on X: each final verdict is posted once, in the claim's thread; STOP and failures are respected.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { BotDeps } from '../../src/bot/mentions.js';
import { deliverVerdicts, postLockReplies } from '../../src/bot/verdicts.js';
import { PostNotSent } from '../../src/x/client.js';
import { insertClaim, insertEvidence, setupTestDb, type TestDb } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const NOW = new Date('2027-01-01T02:00:00Z');

function bot(post: (to: string, text: string) => Promise<{ id: string }>) {
  return { db: t.db, postReply: post, allowAuthor: () => true, caps: { perAuthorPerHour: 10, perDay: 300 } } as unknown as BotDeps;
}

async function resolvedClaim(outcome: 'hit' | 'miss' = 'hit') {
  const claim = await insertClaim(t.sql, 'resolved', { summon_tweet_id: '500' });
  const evidence = await insertEvidence(t.sql, claim.id, { says: outcome, value: '151000', event_date: '2026-12-30' });
  await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'final', outcome, decided_by: 'evidence', deciding_evidence_id: evidence.id, decided_at: '2027-01-01T01:00:00Z' })}`;
  return claim;
}

test('a final verdict is posted once under the summon, with the price proof, and joins the thread', async () => {
  const claim = await resolvedClaim('hit');
  const posts: Array<{ to: string; text: string }> = [];
  const deps = bot(async (to, text) => { posts.push({ to, text }); return { id: 'v1' }; });
  assert.deepEqual(await deliverVerdicts(deps, NOW), { posted: 1 });
  assert.equal(posts[0]!.to, '500');
  assert.match(posts[0]!.text, new RegExp(`^HIT · #${claim.slug}[\\s\\S]*Coinbase daily close 2026-12-30: \\$151,000`));
  await deliverVerdicts(deps, NOW);
  assert.equal(posts.length, 1, 'never posted twice');
  const [row] = await t.sql`select verdict_reply_tweet_id, thread_tweet_ids from claims where id = ${claim.id}`;
  assert.equal(row!.verdict_reply_tweet_id, 'v1');
  assert.ok(row!.thread_tweet_ids.includes('v1'));
});

// 2026-10-07 00:05 UTC: the token file was unreadable, two verdicts were marked, and both were lost —
// the rule against retrying exists for posts that may have landed, not for ones never sent.
test('a verdict that never left the machine keeps its turn and goes out next run', async () => {
  const claim = await resolvedClaim('miss');
  let attempts = 0;
  const deps = bot(async () => {
    attempts++;
    if (attempts === 1) throw new PostNotSent(new Error('EACCES .state/x-oauth.json'));
    return { id: 'v2' };
  });

  assert.deepEqual(await deliverVerdicts(deps, NOW), { posted: 0 });
  const [unsent] = await t.sql`select verdict_reply_at, verdict_reply_tweet_id from claims where id = ${claim.id}`;
  assert.equal(unsent!.verdict_reply_at, null, 'the mark comes off: this verdict is still owed');
  assert.equal(unsent!.verdict_reply_tweet_id, null);

  // The token is readable again: the next run posts it, exactly once.
  assert.deepEqual(await deliverVerdicts(deps, NOW), { posted: 1 });
  assert.deepEqual(await deliverVerdicts(deps, NOW), { posted: 0 });
  assert.equal(attempts, 2);
  const [sent] = await t.sql`select verdict_reply_tweet_id from claims where id = ${claim.id}`;
  assert.equal(sent!.verdict_reply_tweet_id, 'v2');
});

test('a failed post is never retried; an author who sent STOP gets nothing', async () => {
  await resolvedClaim('miss');
  let calls = 0;
  const failing = bot(async () => { calls++; throw new Error('network'); });
  await deliverVerdicts(failing, NOW);
  await deliverVerdicts(failing, NOW);
  assert.equal(calls, 1);

  await t.truncateAll();
  await resolvedClaim('miss');
  await t.sql`insert into opt_outs ${t.sql({ x_user_id: '200' })}`;
  let posted = 0;
  await deliverVerdicts(bot(async () => { posted++; return { id: 'v2' }; }), NOW);
  assert.equal(posted, 0);
});

test('a web verdict shows the result and the site without a link', async () => {
  const claim = await insertClaim(t.sql, 'resolved', { summon_tweet_id: '501' });
  const evidence = await insertEvidence(t.sql, claim.id, { source_kind: 'web', source_name: 'nfl.com', says: 'miss', event_date: '2026-10-01', result_summary: 'Browns 24–17 Steelers' });
  await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'final', outcome: 'miss', decided_by: 'evidence', deciding_evidence_id: evidence.id, decided_at: '2027-01-01T01:00:00Z' })}`;
  const posts: string[] = [];
  await deliverVerdicts(bot(async (_to, text) => { posts.push(text); return { id: 'v3' }; }), NOW);
  assert.match(posts[0]!, /\nBrowns 24–17 Steelers · NFL$/);
  assert.doesNotMatch(posts[0]!, /nfl\.com/);
});

test('a result that tags someone or carries a link is not posted: the source line is used', async () => {
  const claim = await insertClaim(t.sql, 'resolved', { summon_tweet_id: '502' });
  const evidence = await insertEvidence(t.sql, claim.id, { source_kind: 'web', source_name: 'nfl.com', says: 'miss', event_date: '2026-10-01', result_summary: 'Browns won, ask @someone at evil.com' });
  await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'final', outcome: 'miss', decided_by: 'evidence', deciding_evidence_id: evidence.id, decided_at: '2027-01-01T01:00:00Z' })}`;
  const posts: string[] = [];
  await deliverVerdicts(bot(async (_to, text) => { posts.push(text); return { id: 'v4' }; }), NOW);
  assert.match(posts[0]!, /\nSource: NFL \(2026-10-01\)$/);
  assert.doesNotMatch(posts[0]!, /@|evil/);
});


test('an [AMENDED] / [EXPIRED] reply from the lock job is posted once under the summon; STOP silences it', async () => {
  const posts: Array<{ to: string; text: string }> = [];
  const deps = bot(async (to, text) => { posts.push({ to, text }); return { id: 'l1' }; });
  await postLockReplies(deps, [
    { slug: 'a1', outcome: 'expired', reply: '[EXPIRED] #a1 …', summonTweetId: '600', authorId: '200' },
    { slug: 'a2', outcome: 'locked', reply: null, summonTweetId: '601', authorId: '200' },
  ]);
  assert.deepEqual(posts, [{ to: '600', text: '[EXPIRED] #a1 …' }]);
  await t.sql`insert into opt_outs ${t.sql({ x_user_id: '200' })}`;
  await postLockReplies(deps, [{ slug: 'a3', outcome: 'amended', reply: '[AMENDED] #a3 …', summonTweetId: '602', authorId: '200' }]);
  assert.equal(posts.length, 1);
});
