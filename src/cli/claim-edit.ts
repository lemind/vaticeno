// npm run claim:edit -- --slug <slug> --text "<edited post>" — Stage 0 stand-in for the author editing the
// original post on X. The lock job re-reads the post and notices the new version (spec "Amends and edits").
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { claims } from '../db/schema.js';
import { createFileSourceReader } from '../lifecycle/source-reader.js';
import { cliArgs, printJson, runCli } from './run.js';

await runCli('claim-edit', async () => {
  const { values } = cliArgs({ slug: { type: 'string' }, text: { type: 'string' } });
  if (!values.slug || !values.text) throw new Error('usage: --slug <slug> --text "<edited post>"');

  const [claim] = await getDb().select({ post: claims.sourceTweetId }).from(claims).where(eq(claims.slug, values.slug)).limit(1);
  if (!claim) throw new Error(`no claim ${values.slug}`);
  const reader = createFileSourceReader();
  const current = await reader.readVersion(claim.post);
  const versionId = `v${Number(current.versionId.replace(/^v/, '')) + 1}`;
  await reader.write(claim.post, { versionId, text: values.text });
  printJson({ slug: values.slug, post: claim.post, version: versionId });
});
