// npm run content:tick -- pool|original|digest|record|event [--mode repost|quote|joke] [--respect-caps] [--now <ISO>] — one content run by hand, under the advisory lock the
// scheduler uses. It obeys FEED_DRY_RUN: with the default (true) it only records and logs the pick.
// Reading a pool account's posts costs money even in a dry run (spec 002: ~$0.025 per account read).
import { getLockSql } from '../db/client.js';
import { withJobLock } from '../jobs/lock.js';
import { runPoolPost } from '../content/pool-run.js';
import { runOriginalPost } from '../content/original-run.js';
import { runDigest, runRecord } from '../content/record-run.js';
import { runEventPost } from '../content/event-run.js';
import { buildContentDeps } from '../content/wire.js';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('content-tick', async (config) => {
  const { values, positionals } = cliArgs({
    now: { type: 'string' },
    'respect-caps': { type: 'boolean' },
    mode: { type: 'string' },
  });
  const job = positionals[0] ?? 'pool';
  const JOBS = ['pool', 'original', 'digest', 'record', 'event'] as const;
  if (!(JOBS as readonly string[]).includes(job))
    throw new Error(`unknown content job: ${job} (${JOBS.join(' | ')})`);
  // No ENABLE_FEED check: that flag is for the timers (content:job). Typing this command is the intent.
  // Run it on the server — it uses whatever DATABASE_URL and .state/ OAuth token the environment has.

  const now = nowFrom(values.now);
  const content = buildContentDeps(buildDeps(config), config);
  // A hand-run posts even when the day's slots are used: the caps exist to pace the scheduler, not the
  // owner. `--respect-caps` keeps them. Nothing ever posts the same post twice, forced or not.
  const mode = values.mode as 'repost' | 'quote' | 'joke' | undefined;
  if (mode && !['repost', 'quote', 'joke'].includes(mode))
    throw new Error('--mode is repost | quote | joke');
  const options = { force: !values['respect-caps'], ...(mode ? { mode } : {}) };
  // The digest, the record and the event post keep the day's slot even by hand: one own post a day (005 FR-009).
  const runJob = (): Promise<unknown> => {
    switch (job) {
      case 'pool':
        return runPoolPost(content, now, options);
      case 'original':
        return runOriginalPost(content, now, options);
      case 'digest':
        return runDigest(content, now);
      case 'record':
        return runRecord(content, now);
      default:
        return runEventPost(content, now);
    }
  };
  const run = await withJobLock(getLockSql(), job, runJob);
  printJson({
    now: now.toISOString(),
    job,
    dry_run: config.FEED_DRY_RUN,
    result: run.ran ? run.result : 'skipped',
  });
});
