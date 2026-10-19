import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallCost } from '../llm/client.js';
import type { Contract } from './schema.js';
import { followerAccount, parseCount, resolveFollowerContract } from './x-profile.js';

// The contract the normalizer wrote for claim gzrt3 (2026-10-06). "author" meant the account the post replied
// to, @0xPaulvibe; reading the poster's count gave a wrong MISS.
const GZRT3: Contract = {
  subject: "author's X account",
  criterion: 'The author reaches a count of 3,000 followers on X.',
  deadline_at: '2026-10-13T23:59:59Z',
  source: {
    name: 'X.com', kind: 'tech_releases', locator: 'https://twitter.com/i/api/1.1/users/show.json?screen_name=author',
    scope: 'The follower count displayed on the user profile.', entity_id: 'author', absence_is_meaningful: false,
    fallback: 'same_issuer_only',
  },
  negative_condition: 'The follower count is below 3,000 at the end of the deadline day.',
  resolution_method: 'model',
};
const GZRT3_POST = '@0xPaulvibe @vaticeno @0xPaulvibe reaches 3k followers in a week';
const POSTER = '85641384';
const lookup = { getUserByUsername: async (username: string) => ({ id: username === '0xPaulvibe' ? '1614958779489026048' : '99', username }) };

test('the account comes from the post: gzrt3 is about @0xPaulvibe, not the poster', async () => {
  assert.deepEqual(followerAccount(GZRT3_POST, 'vaticeno'), { kind: 'handle', handle: '0xPaulvibe' });
  const costs: CallCost[] = [];
  const out = await resolveFollowerContract(lookup, 'vaticeno', GZRT3, GZRT3_POST, POSTER, costs);
  assert.deepEqual(out.followers, { user_id: '1614958779489026048', comparison: 'AT_LEAST', threshold: 3000 });
  assert.equal(out.source.locator, 'https://x.com/i/user/1614958779489026048');
  assert.equal(costs.length, 1, 'the handle lookup is paid and recorded');
});

test('the poster only when the post says so or names nobody', () => {
  assert.deepEqual(followerAccount("I'll reach 3k followers by Friday", 'vaticeno'), { kind: 'poster' });
  assert.deepEqual(followerAccount('@elonmusk I will reach 3k followers this month', 'vaticeno'), { kind: 'poster' });
  assert.deepEqual(followerAccount('@vaticeno my account hits 5,000 followers', 'vaticeno'), { kind: 'poster' });
  assert.deepEqual(followerAccount('@a @vaticeno @b gets to 10k followers', 'vaticeno'), { kind: 'handle', handle: 'b' }, 'the handle right before the phrase');
  assert.equal(followerAccount('@a will be bigger than @b soon', 'vaticeno'), null, 'no follower phrase: not ours to read');
});

test('when the account is not certain, the contract stays as the model wrote it', async () => {
  assert.equal(await resolveFollowerContract(undefined, 'vaticeno', GZRT3, GZRT3_POST, POSTER, []), GZRT3, 'no X client');
  const failing = { getUserByUsername: async () => { throw new Error('404'); } };
  assert.equal(await resolveFollowerContract(failing, 'vaticeno', GZRT3, GZRT3_POST, POSTER, []), GZRT3, 'unknown handle');
  const notX = { ...GZRT3, source: { ...GZRT3.source, name: 'Instagram', locator: 'https://instagram.com/x' } };
  assert.equal(await resolveFollowerContract(lookup, 'vaticeno', notX, GZRT3_POST, POSTER, []), notX, 'not X');
  const noCount = { ...GZRT3, criterion: 'The author posts every day on X.' };
  assert.equal(await resolveFollowerContract(lookup, 'vaticeno', noCount, GZRT3_POST, POSTER, []), noCount, 'no follower number');
});

test('"below" compares the other way, and counts read like people write them', async () => {
  const below = await resolveFollowerContract(lookup, 'vaticeno', { ...GZRT3, criterion: 'The author has fewer than 3k followers on X.' }, "I'll stay under 3k followers", POSTER, []);
  assert.deepEqual(below.followers, { user_id: POSTER, comparison: 'BELOW', threshold: 3000 });
  assert.equal(parseCount('3,000', undefined), 3000);
  assert.equal(parseCount('3.5', 'k'), 3500);
  assert.equal(parseCount('2', 'M'), 2_000_000);
  assert.equal(parseCount('1.5', undefined), null, 'a fraction of a follower is not a count');
  assert.equal(parseCount('1.1', 'k'), 1100, 'no floating-point leftovers');
});
