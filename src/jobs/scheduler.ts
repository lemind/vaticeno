// In-process cron (plan.md): the same service functions as `jobs:tick`, each under its advisory lock so a
// manual tick never overlaps. One process runs this (ENABLE_JOBS=true on exactly one instance).
import cron from 'node-cron';
import { eq, sql as raw } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Sql } from 'postgres';
import { expireNeedsInfo, expireWithheldDrafts } from '../lifecycle/expire.js';
import { auditOwedWork } from '../lifecycle/reconcile.js';
import { correctRecent } from '../resolve/recheck.js';
import { lockDueDrafts } from '../lifecycle/lock.js';
import type { SourceReader } from '../lifecycle/source-reader.js';
import type { Db } from '../db/client.js';
import { jobState } from '../db/schema.js';
import { log } from '../log.js';
import { captureError, withCronMonitor } from '../observe.js';
import { type ResolverDeps, resolveDueClaims } from '../resolve/resolver.js';
import { confirmBeforeResolving } from '../resolve/settlement.js';
import type { ClaimDeps } from '../lifecycle/claims.js';
import { withJobLock } from './lock.js';
import { type BotDeps, pollMentions } from '../bot/mentions.js';
import {
  deliverCorrections,
  deliverVerdicts,
  postLockReplies,
} from '../bot/verdicts.js';

export type SchedulerDeps = ClaimDeps &
  ResolverDeps & {
    reader: SourceReader;
    sql: Sql;
    bot: BotDeps | null;
  };

// The pool run once a day at an off-the-hour minute, so the feed never looks like a clock (spec 002).
// Every job's time is here; the feed jobs (TIMER_JOBS) run from systemd timers in deploy/, which must match.
export const SCHEDULES = {
  mentions: '* * * * *',
  lock: '* * * * *',
  expire: '*/10 * * * *',
  resolve: '0 * * * *',
  verdicts: '*/5 * * * *',
  pool: '23 9 * * *',
  original: '41 13 * * *',
  // Before the queue on its day, so the record takes the own-post slot (005 FR-009).
  digest: '17 8 * * 1',
  record: '47 9 * * 5',
  // After the queue run, only when the day's own-post slot is still free (005 US3a).
  event: '11 15 * * 2-4',
  // The weekend's Hong Kong race: Friday, once fields and early prices are out; Saturday retries (005 FR-025).
  race: '13 11 * * 5-6',
  reconcile: '17 1-23/2 * * *',
  recheck: '31 4 * * 1',
} as const;

// Own-feed jobs run from systemd timers (`npm run content:job`), so a stopped bot never stops the feed (owner,
// 2026-11-09). The bot still seeds their state rows; the timer's run writes them.
export const TIMER_JOBS = [
  'pool',
  'original',
  'digest',
  'record',
  'event',
  'race',
] as const;
const onTimer = (name: string) => (TIMER_JOBS as readonly string[]).includes(name);

// The longest a job may go between runs. Declared beside the schedule because the cron expression alone
// does not give it: `23 9,18 * * *` has a fifteen-hour gap, not a twelve-hour one (003 FR-001, SC-002).
const INTERVALS_SEC: Record<keyof typeof SCHEDULES, number> = {
  mentions: 60,
  lock: 60,
  expire: 600,
  resolve: 3600,
  verdicts: 300,
  pool: 30 * 3600,
  original: 86_400,
  digest: 7 * 86_400,
  record: 7 * 86_400,
  event: 5 * 86_400,
  race: 6 * 86_400,
  reconcile: 7_200,
  recheck: 7 * 86_400,
};

// Twice the interval plus a minute, never under two minutes (003 data-model → `job_state`).
const staleAfter = (seconds: number) => Math.max(120, seconds * 2 + 60);

type JobDeps = { sql: Sql; db: Db };

// One row per job, written from the code above on every startup, so changing a schedule cannot leave an
// old window behind. A job that has never run then reads as never-run rather than as absent (003 FR-001).
export async function seedJobState(db: Db): Promise<void> {
  const rows = jobNames().map((job) => ({
    job,
    staleAfterSeconds: staleAfter(INTERVALS_SEC[job]),
  }));
  await db
    .insert(jobState)
    .values(rows)
    .onConflictDoUpdate({
      target: jobState.job,
      set: { staleAfterSeconds: raw`excluded.stale_after_seconds` },
    });
}

const jobNames = () => Object.keys(SCHEDULES) as Array<keyof typeof SCHEDULES>;

export async function startScheduler(
  deps: SchedulerDeps,
): Promise<{ stop: () => Promise<void> }> {
  const now = () => new Date();
  const running = new Set<Promise<void>>();
  const jobs: Record<
    Exclude<keyof typeof SCHEDULES, (typeof TIMER_JOBS)[number]>,
    () => Promise<unknown>
  > = {
    // X intake (ENABLE_X): new mentions → engine → one reply each.
    mentions: async () => (deps.bot ? pollMentions(deps.bot, now()) : null),
    // The lock job carries the free plan's one cron monitor: it runs every minute, so silence means down.
    lock: () =>
      withCronMonitor('vaticeno-lock', SCHEDULES.lock, async () => {
        const results = await lockDueDrafts(deps, now());
        if (deps.bot) await postLockReplies(deps.bot, results);
        return results;
      }),
    // Needs info with no amend in 24 h, and drafts whose reply never reached their author (lock withheld).
    expire: async () => ({
      needsInfo: await expireNeedsInfo(deps.db, now()),
      withheldDrafts: await expireWithheldDrafts(deps.db, now()),
    }),
    // Stake verdicts are confirmed first, so a verdict written this run gets its second read the next.
    resolve: async () => {
      await confirmBeforeResolving(deps, now());
      return resolveDueClaims(deps, now());
    },
    // Verdict replies on X (ENABLE_X): one per final verdict, in the claim's thread; then any correction.
    verdicts: async () =>
      deps.bot
        ? {
            ...(await deliverVerdicts(deps.bot, now())),
            corrections: (await deliverCorrections(deps.bot, now())).posted,
          }
        : null,
    // Every two hours: name the work that was owed and never done (src/lifecycle/reconcile.ts).
    reconcile: () => auditOwedWork(deps.db, now()),
    // Mondays: today's rules over last week's verdicts, from stored evidence — free. A verdict they decide
    // differently is corrected; the verdicts job posts it (001 FR-035, owner 2026-11-10).
    recheck: () => correctRecent(deps.db, now()),
  };

  // Reported, never fatal: the database being briefly unreachable at boot is an outage, and an outage is
  // never allowed to stop the service coming up (INIT_SPEC §6.7). The next startup seeds it.
  try {
    await seedJobState(deps.db);
  } catch (error) {
    captureError(error, { event: 'job.state_seed_failed' });
  }
  const tasks = jobNames()
    .filter((name) => !onTimer(name))
    .map((name) =>
      cron.schedule(
        SCHEDULES[name],
        () => {
          const run = runJob(deps, name, jobs[name as keyof typeof jobs]).finally(
            () => running.delete(run),
          );
          running.add(run);
          return run;
        },
        { name, timezone: 'Etc/UTC', noOverlap: true },
      ),
    );
  log('info', 'scheduler started', {
    event: 'scheduler.started',
    jobs: SCHEDULES,
    on_timers: TIMER_JOBS,
  });

  return {
    // Stops future runs and waits for the ones in flight, so a resolver run is never cut off halfway.
    stop: async () => {
      await Promise.all(tasks.map((task) => task.stop()));
      await Promise.all(running);
      log('info', 'scheduler stopped', { event: 'scheduler.stopped' });
    },
  };
}

// A failing job is reported and retried on its next slot; it never takes the process down. Each run
// records what happened, because a variable in this process is not readable by the status page (003 FR-001).
export async function runJob(
  deps: JobDeps,
  name: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    // Started is written inside the lock: a skipped run has not started, and says so (003 FR-020).
    const outcome = await withJobLock(deps.sql, name, async () => {
      await record(deps.db, name, { lastStartedAt: new Date() });
      return fn();
    });
    if (!outcome.ran) return record(deps.db, name, { lastLockedAt: new Date() });
    const at = new Date();
    await record(deps.db, name, {
      lastFinishedAt: at,
      lastOkAt: at,
      lastOutcome: 'ok',
      lastErrorTag: null,
      consecutiveFailures: 0,
    });
  } catch (error) {
    captureError(error, { event: 'job.failed', job: name });
    await record(deps.db, name, {
      lastFinishedAt: new Date(),
      lastOutcome: 'failed',
      lastErrorTag: error instanceof Error ? error.name : 'unknown',
      consecutiveFailures: raw`${jobState.consecutiveFailures} + 1`,
    });
  }
}

// Job health is bookkeeping: failing to write it is reported, never allowed to fail the run itself.
async function record(
  db: Db,
  name: string,
  set: PgUpdateSetSource<typeof jobState>,
): Promise<void> {
  try {
    const written = await db
      .update(jobState)
      .set(set)
      .where(eq(jobState.job, name))
      .returning({ job: jobState.job });
    // No row means this job was never seeded, so its state would go unrecorded in silence.
    if (written.length === 0)
      log('warn', 'job has no state row', {
        event: 'job.state_row_missing',
        job: name,
      });
  } catch (error) {
    captureError(error, { event: 'job.state_write_failed', job: name });
  }
}
