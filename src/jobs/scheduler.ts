// In-process cron (plan.md): the same service functions as `jobs:tick`, each under its advisory lock so a
// manual tick never overlaps. One process runs this (ENABLE_JOBS=true on exactly one instance).
import cron from 'node-cron';
import type { Sql } from 'postgres';
import { expireNeedsInfo, expireWithheldDrafts } from '../lifecycle/expire.js';
import { auditOwedWork } from '../lifecycle/reconcile.js';
import { lockDueDrafts } from '../lifecycle/lock.js';
import type { SourceReader } from '../lifecycle/source-reader.js';
import { log } from '../log.js';
import { captureError, withCronMonitor } from '../observe.js';
import { type ResolverDeps, resolveDueClaims } from '../resolve/resolver.js';
import type { ClaimDeps } from '../lifecycle/claims.js';
import { withJobLock } from './lock.js';
import { type BotDeps, pollMentions } from '../bot/mentions.js';
import { runPoolPost } from '../content/pool-run.js';
import { type OriginalDeps, runOriginalPost } from '../content/original-run.js';
import { deliverVerdicts, postLockReplies } from '../bot/verdicts.js';

export type SchedulerDeps = ClaimDeps & ResolverDeps & { reader: SourceReader; sql: Sql; bot: BotDeps | null; content: OriginalDeps | null };

// The pool run twice a day at an off-the-hour minute, so the feed never looks like a clock (spec 002).
const SCHEDULES = { mentions: '* * * * *', lock: '* * * * *', expire: '*/10 * * * *', resolve: '0 * * * *', verdicts: '*/5 * * * *', pool: '23 9,18 * * *', original: '41 13 * * *', reconcile: '17 1-23/2 * * *' } as const;

export function startScheduler(deps: SchedulerDeps): { stop: () => Promise<void> } {
  const now = () => new Date();
  const running = new Set<Promise<void>>();
  const jobs: Record<keyof typeof SCHEDULES, () => Promise<unknown>> = {
    // X intake (ENABLE_X): new mentions → engine → one reply each.
    mentions: async () => (deps.bot ? pollMentions(deps.bot, now()) : null),
    // The lock job carries the free plan's one cron monitor: it runs every minute, so silence means down.
    lock: () => withCronMonitor('vaticeno-lock', SCHEDULES.lock, async () => {
      const results = await lockDueDrafts(deps, now());
      if (deps.bot) await postLockReplies(deps.bot, results);
      return results;
    }),
    // Needs info with no amend in 24 h, and drafts whose reply never reached their author (lock withheld).
    expire: async () => ({ needsInfo: await expireNeedsInfo(deps.db, now()), withheldDrafts: await expireWithheldDrafts(deps.db, now()) }),
    resolve: () => resolveDueClaims(deps, now()),
    // Verdict replies on X (ENABLE_X): one per final verdict, in the claim's thread.
    verdicts: async () => (deps.bot ? deliverVerdicts(deps.bot, now()) : null),
    // Own feed (ENABLE_FEED): one pool repost or quote post, or just a logged pick in dry run.
    pool: async () => (deps.content ? runPoolPost(deps.content, now()) : null),
    // One owner-written post a day, from the queue; no AI (spec 002 US2).
    original: async () => (deps.content ? runOriginalPost(deps.content, now()) : null),
    // Every two hours: name the work that was owed and never done (src/lifecycle/reconcile.ts).
    reconcile: () => auditOwedWork(deps.db, now()),
  };

  const tasks = (Object.keys(jobs) as Array<keyof typeof SCHEDULES>).map((name) =>
    cron.schedule(SCHEDULES[name], () => {
      const run = runJob(deps.sql, name, jobs[name]).finally(() => running.delete(run));
      running.add(run);
      return run;
    }, { name, timezone: 'Etc/UTC', noOverlap: true }));
  log('info', 'scheduler started', { event: 'scheduler.started', jobs: SCHEDULES });

  return {
    // Stops future runs and waits for the ones in flight, so a resolver run is never cut off halfway.
    stop: async () => {
      await Promise.all(tasks.map((task) => task.stop()));
      await Promise.all(running);
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
