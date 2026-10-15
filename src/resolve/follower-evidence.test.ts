import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallCost } from '../llm/client.js';
import { SourceUnavailable } from './fetch.js';
import { compareFollowers, gatherFollowerEvidence } from './follower-evidence.js';
import { runGates } from './gates.js';

const TERMS = { user_id: '42', comparison: 'AT_LEAST' as const, threshold: 3000 };
const LOCK = new Date('2026-10-06T05:22:02Z');
const DEADLINE = new Date('2026-10-13T23:59:59Z');
const reader = (count: number | null) => ({ getFollowerCount: async () => count });

async function read(count: number | null, now: Date) {
  const costs: CallCost[] = [];
  const out = await gatherFollowerEvidence(reader(count), TERMS, 'https://x.com/i/user/42', DEADLINE, now, costs);
  const { passed } = runGates(out.draft, { lockAt: LOCK, deadlineAt: DEADLINE, absenceIsMeaningful: false });
  return { ...out, passed, costs };
}

test('the comparison: "at least" includes the threshold, "below" does not', () => {
  assert.equal(compareFollowers(TERMS, 3000), 'hit');
  assert.equal(compareFollowers(TERMS, 2999), 'miss');
  assert.equal(compareFollowers({ ...TERMS, comparison: 'BELOW' }, 2999), 'hit');
  assert.equal(compareFollowers({ ...TERMS, comparison: 'BELOW' }, 3000), 'miss');
});

test('the resolver\'s first run after the deadline decides, and passes every gate', async () => {
  const hit = await read(3120, new Date('2026-10-14T00:00:00Z'));
  assert.equal(hit.draft.says, 'hit');
  assert.equal(hit.passed, true);
  assert.equal(hit.value, 3120);
  assert.deepEqual(hit.costs.map((c) => c.provider), ['x'], 'the read is paid for and recorded');
  const miss = await read(2400, new Date('2026-10-14T01:00:00Z'));
  assert.equal(miss.draft.says, 'miss');
  assert.equal(miss.passed, true);
});

test('a read days after the deadline still decides: the current count is the answer (owner decision 2026-10-15)', async () => {
  const late = await read(3120, new Date('2026-10-15T01:00:00Z'));
  assert.equal(late.draft.eventDate, '2026-10-13');
  assert.equal(late.draft.says, 'hit');
  assert.equal(late.passed, true);
});

test('before the deadline it waits, a gone account is entity_gone, and an API failure is an outage', async () => {
  assert.equal((await read(5000, new Date('2026-10-12T00:00:00Z'))).draft.says, 'pending');
  assert.equal((await read(null, new Date('2026-10-14T00:00:00Z'))).draft.says, 'entity_gone');
  const failing = { getFollowerCount: async () => { throw new Error('X API 503'); } };
  await assert.rejects(gatherFollowerEvidence(failing, TERMS, 'u', DEADLINE, new Date(), []), SourceUnavailable);
  await assert.rejects(gatherFollowerEvidence(undefined, TERMS, 'u', DEADLINE, new Date(), []), SourceUnavailable);
});
