// npm run content:tick -- pool|original|receipts [--now <ISO>] — one content run by hand, under the advisory lock the
// scheduler uses. It obeys FEED_DRY_RUN: with the default (true) it only records and logs the pick.
// Reading a pool account's posts costs money even in a dry run (spec 002: ~$0.025 per account read).
import { getSql } from '../db/client.js';
import { withJobLock } from '../jobs/lock.js';
import { runPoolPost } from '../content/pool-run.js';
import { runOriginalPost } from '../content/original-run.js';
import { runReceipts } from '../content/receipt-run.js';
import { buildContentDeps } from '../content/wire.js';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('content-tick', async (config) => {
  const { values, positionals } = cliArgs({ now: { type: 'string' } });
  const job = positionals[0] ?? 'pool';
  if (job !== 'pool' && job !== 'original' && job !== 'receipts') throw new Error(`unknown content job: ${job} (pool | original | receipts)`);
  if (!config.ENABLE_FEED) throw new Error('ENABLE_FEED is false: switch it on in .env to run a content job');

  const now = nowFrom(values.now);
  const content = buildContentDeps(buildDeps(config), config);
  const jobs = { pool: runPoolPost, original: runOriginalPost, receipts: runReceipts };
  const run = await withJobLock(getSql(), job, async (): Promise<unknown> => jobs[job](content, now));
  printJson({ now: now.toISOString(), job, dry_run: config.FEED_DRY_RUN, result: run.ran ? run.result : 'skipped' });
});
