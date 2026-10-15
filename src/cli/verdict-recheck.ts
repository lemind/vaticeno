// npm run verdict:recheck -- [--slug <slug>] [--days 7] [--rejudge] [--correct "<reason>"] [--post]
// A verdict the owner corrects by hand: --correct "<reason>" --outcome hit|miss --deciding-evidence <id>

// Re-decides stored evidence (free), or judges the pages again (--rejudge, paid). Correcting and posting
// are separate flags: a scheduled run never changes a published verdict (001 FR-035).
import { buildBotDeps } from '../bot/wire.js';
import { postCorrection } from '../bot/verdicts.js';
import { loadConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { correctByHand, recheckClaim, recheckRecent, rejudgeClaim, writeCorrection } from '../resolve/recheck.js';
import { createXClient } from '../x/client.js';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('verdict-recheck', async (config) => {
  const { values } = cliArgs({ slug: { type: 'string' }, days: { type: 'string' }, rejudge: { type: 'boolean' }, correct: { type: 'string' }, post: { type: 'boolean' }, now: { type: 'string' }, outcome: { type: 'string' }, 'deciding-evidence': { type: 'string' } });
  const at = nowFrom(values.now);
  const days = Number(values.days ?? 7);
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number of days');
  const db = getDb();

  if (!values.slug) {
    const all = await recheckRecent(db, at, days);
    for (const check of all) printJson({ slug: check.slug, was: check.was, now: check.now, differs: check.differs });
    printJson({
      checked: all.length,
      differing: all.filter((c) => c.differs).map((c) => c.slug),
      no_longer_settled: all.filter((c) => c.unsettled).map((c) => c.slug),
    });
    return;
  }

  // The owner decides from the evidence already stored: no model call, no re-judge (004 T424).
  if (values.outcome) {
    if (!values.slug || !values.correct) throw new Error('--outcome needs --slug and --correct "<reason>"');
    if (values.outcome !== 'hit' && values.outcome !== 'miss') throw new Error('--outcome is hit or miss');
    if (!values['deciding-evidence']) throw new Error('--deciding-evidence <id> is required: the row that shows it');
    const corrected = await correctByHand(db, values.slug, values.outcome, values['deciding-evidence'], values.correct);
    printJson({ corrected, by: 'human' });
    if (!corrected || !values.post) return;
    printJson(await postCorrection(buildBotDeps(buildDeps(config)), values.slug, at));
    return;
  }

  // Paid, and never scheduled: fetch and judge the pages again, which is the only way to catch a judging
  // error rather than a rule error (004 T415a).
  const check = values.rejudge
    ? await rejudgeClaim({ ...buildDeps(config), x: createXClient(loadConfig().X_BEARER_TOKEN), botHandle: loadConfig().X_BOT_HANDLE }, values.slug, at) // x: follower counts (004 T420)
    : await recheckClaim(db, values.slug, at);
  if (!check) throw new Error(`no final verdict for ${values.slug}`);
  printJson(check);
  if (!values.correct) return;
  if (!check.differs) throw new Error('the rules reach the same verdict; nothing to correct');

  const corrected = await writeCorrection(db, values.slug, check, values.correct);
  printJson({ corrected });
  if (!corrected || !values.post) return;

  // Paid: one reply in the claim's thread.
  const bot = buildBotDeps(buildDeps(config));
  printJson(await postCorrection(bot, values.slug, at));
});
