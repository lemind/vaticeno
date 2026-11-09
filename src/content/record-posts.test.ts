import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deadlineDigest, recordPost, type WeekCounts } from './record-posts.js';

const NOW = new Date('2027-01-04T08:17:00Z');
const day = (d: string) => new Date(`${d}T23:59:59Z`);

test('the digest: due this week, soonest first, at most five, never a slug twice in a week', () => {
  const due = ['a2b3c', 'd4e5f', 'g6h7j', 'k8m9n', 'p2q3r', 's4t5u'].map(
    (slug, i) => ({
      slug,
      deadlineAt: day(`2027-01-0${5 + (i % 5)}`),
    }),
  );
  const digest = deadlineDigest(
    [...due, { slug: 'v6w7x', deadlineAt: day('2027-01-20') }],
    NOW,
    new Set(),
  );
  assert.ok(digest);
  assert.deepEqual(digest.slugs.length, 5);
  assert.match(digest.text, /^Coming due this week on the record:\n#a2b3c · 5 Jan/);
  assert.match(digest.text, /…and 1 more\.$/);
  assert.ok(!digest.text.includes('v6w7x'), 'two weeks out is not this week');
  assert.equal(
    deadlineDigest(due, NOW, new Set(due.map((c) => c.slug))),
    null,
    'all named already',
  );
  assert.equal(deadlineDigest([], NOW, new Set()), null, 'nothing due is no post');
});

test('the record: counts only; the same numbers or an empty week post nothing', () => {
  const counts: WeekCounts = {
    recorded: 4,
    cameDue: 3,
    hit: 1,
    miss: 1,
    void: 1,
    open: 6,
  };
  assert.equal(
    recordPost(counts, null),
    'The week on the record: 4 recorded, 3 came due — 1 HIT, 1 MISS, 1 VOID. 6 still open.',
  );
  assert.equal(recordPost(counts, { ...counts }), null);
  assert.equal(
    recordPost({ recorded: 0, cameDue: 0, hit: 0, miss: 0, void: 0, open: 0 }, null),
    null,
  );
});
