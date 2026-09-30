// In-process cron (plan.md): the same service functions as `jobs:tick`, each under its advisory lock so a
// manual tick never overlaps. One process runs this (ENABLE_JOBS=true on exactly one instance).
import cron from 'node-cron';
import type { Sql } from 'postgres';
import { expireNeedsInfo } from '../lifecycle/expire.js';
import { lockDueDrafts } from '../lifecycle/lock.js';
import type { SourceReader } from '../lifecycle/source-reader.js';
import { log } from '../log.js';
import { captureError, withCronMonitor } from '../observe.js';
import { type ResolverDeps, resolveDueClaims } from '../resolve/resolver.js';
import type { ClaimDeps } from '../lifecycle/claims.js';
import { withJobLock } from './lock.js';

export type SchedulerDeps = ClaimDeps & ResolverDeps & { reader: SourceReader; sql: Sql; now?: () => Date };

export const SCHEDULES = { lock: '* * * * *', expire: '*/10 * * * *', resolve: '0 * * * *' } as const;

export function startScheduler(deps: SchedulerDeps): { stop: () => Promise<void> } {
  const now = deps.now ?? (() => new Date());
  const jobs: Record<keyof typeof SCHEDULES, () => Promise<unknown>> = {
    // The lock job carries the free plan's one cron monitor: it runs every minute, so silence means down.
    lock: () => withCronMonitor('vaticeno-lock', SCHEDULES.lock, () => lockDueDrafts(deps, now())),
    expire: () => expireNeedsInfo(deps.db, now()),
    resolve: () => resolveDueClaims(deps, now()),
  };

  const tasks = (Object.keys(jobs) as Array<keyof typeof SCHEDULES>).map((name) =>
    cron.schedule(SCHEDULES[name], () => runJob(deps.sql, name, jobs[name]), { name, timezone: 'Etc/UTC', noOverlap: true }));
  log('info', 'scheduler started', { event: 'scheduler.started', jobs: SCHEDULES });

  return {
    stop: async () => {
      await Promise.all(tasks.map((task) => task.stop()));
      log('info', 'scheduler stopped', { event: 'scheduler.stopped' });
    },
  };
}

// A failing job is reported and retried on its next slot; it never takes the process down.
export async function runJob(sql: Sql, name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await withJobLock(sql, name, fn);
  } catch (error) {
    captureError(error, { event: 'job.failed', job: name });
  }
}
