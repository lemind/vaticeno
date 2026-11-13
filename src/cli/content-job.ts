// npm run content:job -- pool|original|digest|record|event|race — one scheduled feed run, started by its systemd timer
// (deploy/vaticeno-content-*.timer), so the feed runs even when the bot does not. Obeys ENABLE_FEED, FEED_DRY_RUN
// and every cap, and writes the job's state for the status page. By hand, use content:tick.
import { getLockSql } from '../db/client.js';
import { runJob, TIMER_JOBS } from '../jobs/scheduler.js';
import { runPoolPost } from '../content/pool-run.js';
import { runOriginalPost } from '../content/original-run.js';
import { runDigest, runRecord } from '../content/record-run.js';
import { runEventPost } from '../content/event-run.js';
import { runRacePost } from '../content/race-run.js';
import { buildContentDeps } from '../content/wire.js';
import { log } from '../log.js';
import { buildDeps, cliArgs, runCli } from './run.js';

await runCli('content-job', async (config) => {
  const { positionals } = cliArgs({});
  const job = positionals[0] ?? '';
  if (!(TIMER_JOBS as readonly string[]).includes(job))
    throw new Error(`unknown feed job: ${job} (${TIMER_JOBS.join(' | ')})`);
  if (!config.ENABLE_FEED) {
    log('info', 'feed off: nothing to run', { event: 'feed.off', job });
    return;
  }
  const deps = buildDeps(config);
  const content = buildContentDeps(deps, config);
  const now = new Date();
  await runJob({ sql: getLockSql(), db: deps.db }, job, () => {
    switch (job) {
      case 'pool':
        return runPoolPost(content, now);
      case 'original':
        return runOriginalPost(content, now);
      case 'digest':
        return runDigest(content, now);
      case 'record':
        return runRecord(content, now);
      case 'race':
        return runRacePost(content, now);
      default:
        return runEventPost(content, now);
    }
  });
});
