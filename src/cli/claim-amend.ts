// npm run claim:amend -- --slug <slug> --text "<what happens> by <YYYY-MM-DD>" [--author <x_user_id>] [--now <ISO>]
import { claims } from '../db/schema.js';
import { amendClaim } from '../lifecycle/claims.js';
import { createFileSourceReader } from '../lifecycle/source-reader.js';
import { eq } from 'drizzle-orm';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('claim-amend', async (config) => {
  const { values } = cliArgs({ slug: { type: 'string' }, text: { type: 'string' }, author: { type: 'string' }, now: { type: 'string' } });
  if (!values.slug || !values.text) throw new Error('usage: --slug <slug> --text "<what happens> by <YYYY-MM-DD>" [--author <id>]');

  const deps = buildDeps(config);
  // Stage 0 convenience: default to the claim's own author.
  const [claim] = await deps.db.select({ author: claims.authorXUserId }).from(claims).where(eq(claims.slug, values.slug)).limit(1);
  const result = await amendClaim({ ...deps, reader: createFileSourceReader() }, {
    slug: values.slug,
    authorId: values.author ?? claim?.author ?? '',
    text: values.text.replace(/^amend\s+/i, ''),
    now: nowFrom(values.now),
  });
  printJson({ slug: values.slug, outcome: result.outcome, reply: result.reply });
});
