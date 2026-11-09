import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_QUERY_CHARS,
  REPOST_GROUPS,
  groupFor,
  groupQuery,
} from './repost-groups.js';

test('one group per weekday, each query short enough for X', () => {
  assert.equal(REPOST_GROUPS.length, 7);
  for (const group of REPOST_GROUPS)
    assert.ok(
      groupQuery(group).length <= MAX_QUERY_CHARS,
      `${group.name}: ${groupQuery(group).length}`,
    );
});

test('the fallback is the next day’s group, Saturday wrapping to Sunday', () => {
  const saturday = new Date('2026-11-14T09:23:00Z');
  assert.equal(groupFor(saturday).name, 'launches and awards');
  assert.equal(groupFor(saturday, 1).name, 'markets and crypto');
});
