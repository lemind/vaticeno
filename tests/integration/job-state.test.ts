// Every job in SCHEDULES reports its own state, so the status page reads it instead of a variable inside
// this process (003 FR-001, T310). The checkpoint of 003 Stage 1 Phase 2.
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { after, before, beforeEach, test } from 'node:test';
import { jobState } from '../../src/db/schema.js';
import { withJobLock } from '../../src/jobs/lock.js';
import { runJob, SCHEDULES, seedJobState } from '../../src/jobs/scheduler.js';
import { setupTestDb, type TestDb } from './helpers.js';

let t: TestDb;
before(async () => {
  t = await setupTestDb();
});
after(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.sql`delete from job_state`;
});

const stateOf = async (job: string) =>
  (await t.db.select().from(jobState).where(eq(jobState.job, job)))[0];

test('seeding writes one row per scheduled job, and a job that never ran says so', async () => {
  await seedJobState(t.db);
  const names = Object.keys(SCHEDULES);
  const rows = await t.db.select().from(jobState);
  assert.deepEqual(
    rows.map((r) => r.job).sort(),
    [...names].sort(),
    'SCHEDULES is the only job list',
  );
  const resolve = await stateOf('resolve');
  assert.equal(resolve?.lastStartedAt, null);
  assert.equal(
    resolve?.lastOutcome,
    null,
    'never-run reads as never-run, not as absent',
  );
  // Hourly job: twice the interval plus a minute.
  assert.equal(resolve?.staleAfterSeconds, 7_260);
  // A once-a-minute job and a weekly one are not late at the same point (SC-002).
  assert.equal((await stateOf('lock'))?.staleAfterSeconds, 180);
  assert.equal((await stateOf('recheck'))?.staleAfterSeconds, 1_209_660);
});

test('seeding again overwrites the window, so a schedule change cannot leave an old one behind', async () => {
  await seedJobState(t.db);
  await t.db
    .update(jobState)
    .set({ staleAfterSeconds: 99, lastErrorTag: 'Stale' })
    .where(eq(jobState.job, 'resolve'));
  await seedJobState(t.db);
  const resolve = await stateOf('resolve');
  assert.equal(resolve?.staleAfterSeconds, 7_260);
  assert.equal(
    resolve?.lastErrorTag,
    'Stale',
    'seeding rewrites the window only, never the history',
  );
});

test('a successful run records start, finish and success', async () => {
  await seedJobState(t.db);
  await t.db
    .update(jobState)
    .set({ consecutiveFailures: 3 })
    .where(eq(jobState.job, 'expire'));
  await runJob({ sql: t.sql, db: t.db }, 'expire', async () => 'done');
  const row = await stateOf('expire');
  assert.equal(row?.lastOutcome, 'ok');
  assert.ok(row?.lastStartedAt && row.lastFinishedAt && row.lastOkAt);
  assert.ok(row.lastStartedAt <= row.lastFinishedAt);
  assert.equal(row.consecutiveFailures, 0, 'a success resets the streak');
  assert.equal(row.lastErrorTag, null);
});

test('a failing run records the tag it sent to Sentry and counts the streak', async () => {
  await seedJobState(t.db);
  class SourceUnavailable extends Error {
    constructor() {
      super('down');
      this.name = 'SourceUnavailable';
    }
  }
  await runJob({ sql: t.sql, db: t.db }, 'resolve', async () => {
    throw new SourceUnavailable();
  });
  let row = await stateOf('resolve');
  assert.equal(row?.lastOutcome, 'failed');
  assert.equal(row?.lastErrorTag, 'SourceUnavailable');
  assert.equal(row?.lastOkAt, null, 'a failure never claims a success');
  assert.equal(row?.consecutiveFailures, 1);
  await runJob({ sql: t.sql, db: t.db }, 'resolve', async () => {
    throw new SourceUnavailable();
  });
  row = await stateOf('resolve');
  assert.equal(row?.consecutiveFailures, 2);
});

// The incident of 2026-10-13 08:00: five jobs fire together at the top of every hour, each reserving a
// connection for its advisory lock. On the query pool that is all five, so every query inside those jobs
// waited for a connection that could never free, and systemd had to kill the process.
test('five jobs starting at once all finish, rather than deadlocking on connections', async () => {
  await seedJobState(t.db);
  const atOnce = ['mentions', 'lock', 'expire', 'resolve', 'verdicts'];
  const finished: string[] = [];

  const runs = atOnce.map((job) =>
    runJob({ sql: t.locks, db: t.db }, job, async () => {
      // Every real job queries inside its lock; that is what had nowhere to run.
      await t.db.select().from(jobState).limit(1);
      finished.push(job);
    }),
  );
  const raced = await Promise.race([
    Promise.all(runs).then(() => 'done' as const),
    new Promise<'hung'>((resolve) =>
      setTimeout(() => resolve('hung'), 10_000).unref(),
    ),
  ]);

  assert.equal(raced, 'done', 'the job loop did not wedge');
  assert.deepEqual(finished.sort(), [...atOnce].sort());
  for (const job of atOnce) assert.equal((await stateOf(job))?.lastOutcome, 'ok');
});

test('a job with no state row is reported, not silently unrecorded', async () => {
  // `record` only updates, so a name that was never seeded would otherwise write nothing and look fine.
  let ran = false;
  await runJob({ sql: t.sql, db: t.db }, 'not-a-job', async () => {
    ran = true;
  });
  assert.equal(
    ran,
    true,
    'the job still runs; its bookkeeping is not a precondition',
  );
  assert.equal(
    await stateOf('not-a-job'),
    undefined,
    'and no row was invented for it',
  );
});

test('a run skipped on the lock writes only that it was skipped', async () => {
  await seedJobState(t.db);
  let ran = false;
  // The lock is normally held by a run that is working, so a skip is not an outcome (003 data-model).
  await withJobLock(t.sql, 'verdicts', async () => {
    await runJob({ sql: t.sql, db: t.db }, 'verdicts', async () => {
      ran = true;
    });
  });
  assert.equal(ran, false, 'the job did not run twice');
  const row = await stateOf('verdicts');
  assert.ok(row?.lastLockedAt, 'the skip is recorded');
  assert.equal(row?.lastStartedAt, null, 'a skipped run never started');
  assert.equal(row?.lastOutcome, null, 'a healthy job is not reported as broken');
});
