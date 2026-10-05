// Which post a run may take (spec 002 FR-002): the newest one under 48 h that we have never posted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestEligible } from './eligible.js';

const NOW = new Date('2027-03-10T12:00:00Z');
const post = (id: string, iso?: string) => ({ id, text: `post ${id}`, created_at: iso });

test('the newest post wins, whatever order X returns them in', () => {
  const posts = [post('a', '2027-03-09T12:00:00Z'), post('b', '2027-03-10T09:00:00Z'), post('c', '2027-03-08T12:00:00Z')];
  assert.equal(latestEligible(posts, NOW, new Set())?.id, 'b');
});

test('posts older than 48 h, already used, or undated are skipped', () => {
  assert.equal(latestEligible([post('old', '2027-03-07T11:00:00Z')], NOW, new Set()), null);
  assert.equal(latestEligible([post('used', '2027-03-10T09:00:00Z')], NOW, new Set(['used'])), null);
  assert.equal(latestEligible([post('nodate')], NOW, new Set()), null);
  // Far in the future is nonsense; a couple of minutes is just clock skew on a brand-new post.
  assert.equal(latestEligible([post('ahead', '2027-03-10T12:30:00Z')], NOW, new Set()), null);
  assert.equal(latestEligible([post('justnow', '2027-03-10T12:00:30Z')], NOW, new Set())?.id, 'justnow');
  assert.equal(latestEligible([], NOW, new Set()), null);
});

test('one unusable post does not hide a good one', () => {
  const posts = [post('nodate'), post('old', '2027-03-01T12:00:00Z'), post('good', '2027-03-10T08:00:00Z')];
  assert.equal(latestEligible(posts, NOW, new Set())?.id, 'good');
});
