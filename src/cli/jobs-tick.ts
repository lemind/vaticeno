// npm run jobs:tick -- [--now <ISO>] — one pass of each job: lock, expire needs-info, resolve. Each runs
// under its own advisory lock, so cron and a manual tick never overlap.
import { getSql } from '../db/client.js';
import { expireNeedsInfo } from '../lifecycle/expire.js';
import { lockDueDrafts } from '../lifecycle/lock.js';
import { createFileSourceReader } from '../lifecycle/source-reader.js';
import { withJobLock } from '../jobs/lock.js';
import { resolveDueClaims } from '../resolve/resolver.js';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('jobs-tick', async (config) => {
  const { values } = cliArgs({ now: { type: 'string' } });
  const now = nowFrom(values.now);
  const deps = buildDeps(config);
  const sql = getSql();

  const lock = await withJobLock(sql, 'lock', () => lockDueDrafts({ ...deps, reader: createFileSourceReader() }, now));
  const expire = await withJobLock(sql, 'expire', () => expireNeedsInfo(deps.db, now));
  const resolve = await withJobLock(sql, 'resolve', () => resolveDueClaims(deps, now));

  printJson({
    now: now.toISOString(),
    lock: lock.ran ? lock.result : 'skipped',
    expired_needs_info: expire.ran ? expire.result : 'skipped',
    resolve: resolve.ran ? resolve.result : 'skipped',
  });
});
