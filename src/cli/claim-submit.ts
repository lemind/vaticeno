// npm run claim:submit -- --text "<prediction>" --author <x_user_id> --post <tweet_id> [--now <ISO>]
import { submitClaim } from '../lifecycle/claims.js';
import { createFileSourceReader } from '../lifecycle/source-reader.js';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('claim-submit', async (config) => {
  const { values } = cliArgs({
    text: { type: 'string' },
    author: { type: 'string' },
    post: { type: 'string' },
    now: { type: 'string' },
  });
  if (!values.text || !values.author || !values.post) throw new Error('usage: --text "<prediction>" --author <x_user_id> --post <tweet_id>');

  // Stage 0 stands in for X: the post lives in a local simulation file (gitignored .state/).
  await createFileSourceReader().write(values.post, { versionId: 'v1', text: values.text });

  const result = await submitClaim(buildDeps(config), {
    text: values.text,
    authorId: values.author,
    sourceTweetId: values.post,
    summonTweetId: `${values.post}-summon`, // Stage 0: no real summon tweet
    sourceVersion: 'v1',
    now: nowFrom(values.now),
  });
  printJson({ slug: result.slug, outcome: result.outcome, reject_reason: result.rejectReason, reply: result.reply });
});
