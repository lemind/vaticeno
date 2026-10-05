// Jobs run under their advisory lock, and a failing job is reported, never thrown (T074).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { withJobLock } from '../../src/jobs/lock.js';
import { runJob } from '../../src/jobs/scheduler.js';
import { setupTestDb, type TestDb } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });

test('a failing job does not throw; the next run is free to go', async () => {
  await runJob(t.sql, 'boom', async () => { throw new Error('job broke'); });
  let ran = false;
  await runJob(t.sql, 'boom', async () => { ran = true; });
  assert.equal(ran, true, 'the lock was released after the failure');
});

test('a job already running elsewhere is skipped, not run twice', async () => {
  let inner: unknown;
  await withJobLock(t.sql, 'resolve', async () => {
    inner = await withJobLock(t.sql, 'resolve', async () => 'second');
  });
  assert.deepEqual(inner, { ran: false });
});
