// npm run review:list — resolutions waiting for a human, with the latest run's evidence.
import { getDb } from '../db/client.js';
import { listNeedsHuman } from '../resolve/manual.js';
import { printJson, runCli } from './run.js';

await runCli('review-list', async () => {
  const flagged = await listNeedsHuman(getDb());
  for (const item of flagged) printJson(item);
  printJson({ needs_human: flagged.length });
});
