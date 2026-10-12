// npm run verdict:recheck -- [--slug <slug>] [--days 7] [--correct "<reason>"] [--post]
// Re-decides verdicts with today's rules, over the evidence already stored: free, no model, no searches.
// Writing the correction and posting it are separate flags, because a published verdict is never changed
// by a scheduled run (001 FR-035).
import { eq } from 'drizzle-orm';
import { claims } from '../db/schema.js';
import { buildBotDeps } from '../bot/wire.js';
import { postCorrection } from '../bot/verdicts.js';
import { getDb } from '../db/client.js';
import { recheckClaim, recheckRecent, writeCorrection } from '../resolve/recheck.js';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('verdict-recheck', async (config) => {
  const { values } = cliArgs({ slug: { type: 'string' }, days: { type: 'string' }, correct: { type: 'string' }, post: { type: 'boolean' }, now: { type: 'string' } });
  const at = nowFrom(values.now);
  const db = getDb();

  if (!values.slug) {
    const all = await recheckRecent(db, at, Number(values.days ?? 7));
    for (const check of all) printJson({ slug: check.slug, was: check.was, now: check.now, differs: check.differs });
    printJson({
      checked: all.length,
      differing: all.filter((c) => c.differs).map((c) => c.slug),
      no_longer_settled: all.filter((c) => c.unsettled).map((c) => c.slug),
    });
    return;
  }

  const check = await recheckClaim(db, values.slug, at);
  if (!check) throw new Error(`no final verdict for ${values.slug}`);
  printJson(check);
  if (!values.correct) return;
  if (!check.differs) throw new Error('the rules reach the same verdict; nothing to correct');

  const corrected = await writeCorrection(db, values.slug, check, values.correct);
  printJson({ corrected });
  if (!corrected || !values.post) return;

  // Paid: one reply in the claim's thread.
  const [claim] = await db.select({ id: claims.id }).from(claims).where(eq(claims.slug, values.slug)).limit(1);
  if (!claim) return;
  const bot = buildBotDeps(buildDeps(config));
  printJson(await postCorrection(bot, values.slug));
});
