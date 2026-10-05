// npm run content:pool-ids [-- handle handle …] — one-off, PAID: resolves pool handles to numeric X ids
// (~$0.010 per user returned) so src/content/pool.ts never needs a user lookup at run time (spec 002 T003).
// Run again only when the owner changes the pool. The pool itself lives in docs/content-rules.md.
import { createXClient } from '../x/client.js';
import { loadConfig } from '../config.js';
import { printJson, runCli } from './run.js';

const POOL_HANDLES = [
  'FabrizioRomano', 'AdamSchefter', 'NateSilver538', 'Kalshi', '100trillionUSD', 'RaoulGMI', 'StatMuse',
  'OptaJoe', 'ESPNStatsInfo', 'OptaAnalyst', 'OurWorldInData', 'gelliottmorris', 'metaculus', 'Statsbomb',
  'ManifoldMarkets', '_1woonomic',
];

await runCli('pool-ids', async () => {
  const handles = process.argv.slice(2).filter(Boolean);
  const wanted = handles.length > 0 ? handles : POOL_HANDLES;
  const x = createXClient(loadConfig().X_BEARER_TOKEN);

  let failed = 0;
  for (const handle of wanted) {
    try {
      const user = await x.getUserByUsername(handle);
      printJson({ handle: user.username, id: user.id });
    } catch (error) {
      failed += 1;
      printJson({ handle, error: error instanceof Error ? error.message : String(error) });
    }
  }
  printJson({ resolved: wanted.length - failed, failed, est_usd: (wanted.length * 0.01).toFixed(2) });
});
