// npm run content:tick -- pool|original|digest|record [--mode repost|quote|joke] [--respect-caps] [--now <ISO>] — one content run by hand, under the advisory lock the
// scheduler uses. It obeys FEED_DRY_RUN: with the default (true) it only records and logs the pick.
// Reading a pool account's posts costs money even in a dry run (spec 002: ~$0.025 per account read).
import { getLockSql } from '../db/client.js';
import { withJobLock } from '../jobs/lock.js';
import { runPoolPost } from '../content/pool-run.js';
import { runOriginalPost } from '../content/original-run.js';
import { runDigest, runRecord } from '../content/record-run.js';
import { buildContentDeps } from '../content/wire.js';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('content-tick', async (config) => {
  const { values, positionals } = cliArgs({
    now: { type: 'string' },
    'respect-caps': { type: 'boolean' },
    mode: { type: 'string' },
  });
  const job = positionals[0] ?? 'pool';
  if (job !== 'pool' && job !== 'original' && job !== 'digest' && job !== 'record')
    throw new Error(
      `unknown content job: ${job} (pool | original | digest | record)`,
    );
  // No ENABLE_FEED check: that flag is for the scheduler. Typing this command is the intent.
  // Run it on the server — it uses whatever DATABASE_URL and .state/ OAuth token the environment has.

  const now = nowFrom(values.now);
  const content = buildContentDeps(buildDeps(config), config);
  // A hand-run posts even when the day's slots are used: the caps exist to pace the scheduler, not the
  // owner. `--respect-caps` keeps them. Nothing ever posts the same post twice, forced or not.
  const mode = values.mode as 'repost' | 'quote' | 'joke' | undefined;
  if (mode && !['repost', 'quote', 'joke'].includes(mode))
    throw new Error('--mode is repost | quote | joke');
  const options = { force: !values['respect-caps'], ...(mode ? { mode } : {}) };
  // The digest and the record keep the day's slot even by hand: one own post a day (005 FR-009).
  const jobs = {
    pool: runPoolPost,
    original: runOriginalPost,
    digest: (deps: typeof content, at: Date) => runDigest(deps, at),
    record: (deps: typeof content, at: Date) => runRecord(deps, at),
  };
  const run = await withJobLock(getLockSql(), job, async (): Promise<unknown> =>
    jobs[job](content, now, options),
  );
  printJson({
    now: now.toISOString(),
    job,
    dry_run: config.FEED_DRY_RUN,
    result: run.ran ? run.result : 'skipped',
  });
});
