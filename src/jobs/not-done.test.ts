import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notDoneReason } from './not-done.js';

test('the owner is told when planned work was not done, never when the plan worked', () => {
  assert.match(
    notDoneReason('verdict', { done: 'failed', error: 'XApiError: 403' })!,
    /X refused the post: XApiError: 403/,
  );
  assert.match(notDoneReason('pool', { done: 'spend_cap' })!, /spend cap/);
  assert.match(
    notDoneReason('event', { done: 'no_event', why: ['awards: one site'] })!,
    /two sites:\n- awards: one site/,
  );
  assert.match(
    notDoneReason('race', { done: 'no_race', why: 'race not priced' })!,
    /race not priced/,
  );
  for (const [job, done] of [
    ['original', 'empty_queue'],
    ['event', 'slot_taken'],
    ['verdict', 'nothing_new'],
    ['digest', 'nothing_new'],
    ['pool', 'posted'],
    ['lock', undefined],
  ] as const)
    assert.equal(notDoneReason(job, { done }), null, `${job} ${done}`);
});
