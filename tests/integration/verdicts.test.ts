// Verdict replies on X: each final verdict is posted once, in the claim's thread; STOP and failures are respected.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { BotDeps } from '../../src/bot/mentions.js';
import { deliverVerdicts } from '../../src/bot/verdicts.js';
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
