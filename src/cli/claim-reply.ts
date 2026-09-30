// npm run claim:reply -- --slug <slug> --text "<the prediction again, with a date>" [--author <x_user_id>] [--now <ISO>]
// Stage 0 stand-in for the author replying under the bot's reply: any author reply is the fix, no keyword.
import { claims } from '../db/schema.js';
import { amendClaim } from '../lifecycle/claims.js';
import { createFileSourceReader } from '../lifecycle/source-reader.js';
import { eq } from 'drizzle-orm';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('claim-reply', async (config) => {
  const { values } = cliArgs({ slug: { type: 'string' }, text: { type: 'string' }, author: { type: 'string' }, now: { type: 'string' } });
  if (!values.slug || !values.text) throw new Error('usage: --slug <slug> --text "<the prediction again, with a date>" [--author <id>]');

  const deps = buildDeps(config);
  // Stage 0 convenience: default to the claim's own author.
  const [claim] = await deps.db.select({ author: claims.authorXUserId }).from(claims).where(eq(claims.slug, values.slug)).limit(1);
  const result = await amendClaim({ ...deps, reader: createFileSourceReader() }, {
    slug: values.slug,
    authorId: values.author ?? claim?.author ?? '',
    text: values.text,
    now: nowFrom(values.now),
  });
  printJson({ slug: values.slug, outcome: result.outcome, reply: result.reply });
});
