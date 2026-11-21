import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_QUERY_CHARS,
  REPOST_GROUPS,
  groupQuery,
  groupsFrom,
} from './repost-groups.js';

test('one group per weekday, each query short enough for X', () => {
  assert.equal(REPOST_GROUPS.length, 7);
  for (const group of REPOST_GROUPS)
    assert.ok(
      groupQuery(group).length <= MAX_QUERY_CHARS,
      `${group.name}: ${groupQuery(group).length}`,
    );
});

test('the search walks every group from the day’s; awards lead every other Saturday only', () => {
  const names = (day: string) =>
    groupsFrom(new Date(`${day}T09:23:00Z`)).map((g) => g.name);
  assert.deepEqual(names('2026-11-21'), [
    'launches and awards',
    'markets and crypto',
    'F1, MotoGP and space',
    'football',
    'combat sports',
    'US sports',
    'cricket, tennis, golf and racing',
  ]);
  assert.equal(names('2026-11-28')[0], 'markets and crypto');
  assert.equal(names('2026-11-28').length, 6);
  assert.equal(names('2026-12-05')[0], 'launches and awards');
  assert.equal(names('2026-11-23')[0], 'F1, MotoGP and space');
  assert.ok(!names('2026-11-23').includes('launches and awards'));
});
