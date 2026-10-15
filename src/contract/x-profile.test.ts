import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Contract } from './schema.js';
import { asAuthorFollowerContract, parseCount } from './x-profile.js';

// The contract the normalizer wrote for claim gzrt3 (2026-10-06): "author" was never replaced by an account.
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

test('the gzrt3 contract becomes a follower read of the author\'s own account', () => {
  const out = asAuthorFollowerContract(GZRT3, '1234567890');
  assert.equal(out.source.kind, 'x_profile');
  assert.equal(out.source.locator, 'https://x.com/i/user/1234567890');
  assert.deepEqual(out.followers, { user_id: '1234567890', comparison: 'AT_LEAST', threshold: 3000 });
  assert.equal(out.criterion, GZRT3.criterion, 'what the author asked for is kept');
});

test('anything else is left as the model wrote it', () => {
  const notX = { ...GZRT3, source: { ...GZRT3.source, name: 'Instagram', locator: 'https://instagram.com/x' } };
  assert.equal(asAuthorFollowerContract(notX, '1'), notX, 'not X');
  const noCount = { ...GZRT3, criterion: 'The author posts every day on X.' };
  assert.equal(asAuthorFollowerContract(noCount, '1'), noCount, 'no follower number');
  const someoneElse = { ...GZRT3, subject: 'Elon Musk', source: { ...GZRT3.source, entity_id: '@elonmusk' } };
  assert.equal(asAuthorFollowerContract(someoneElse, '1'), someoneElse, 'another account: not handled here');
  assert.equal(asAuthorFollowerContract(GZRT3, 'not-a-number'), GZRT3, 'no usable author id');
});

test('"below" claims compare the other way, and counts read like people write them', () => {
  const below = asAuthorFollowerContract({ ...GZRT3, criterion: 'The author has fewer than 3k followers on X.' }, '7');
  assert.deepEqual(below.followers, { user_id: '7', comparison: 'BELOW', threshold: 3000 });
  assert.equal(parseCount('3,000', undefined), 3000);
  assert.equal(parseCount('3.5', 'k'), 3500);
  assert.equal(parseCount('2', 'M'), 2_000_000);
  assert.equal(parseCount('1.5', undefined), null, 'a fraction of a follower is not a count');
});
