// npm run claim:recheck -- --slug <slug> [--post] — re-judge a needs-info claim with today's normalizer
// and, with --post, reply in its thread. For claims that were refused by an older prompt version: the
// author's post is unchanged, so this is the same text going through the current rules (no new claim).
// Run it on the server, where the bot's OAuth token lives. Paid: one post read, and one reply with --post.
import { eq } from 'drizzle-orm';
import { claims } from '../db/schema.js';
import { amendClaim } from '../lifecycle/claims.js';
import { buildBotDeps } from '../bot/wire.js';
import { buildDeps, cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('claim-recheck', async (config) => {
  const { values } = cliArgs({ slug: { type: 'string' }, post: { type: 'boolean' }, now: { type: 'string' } });
  if (!values.slug) throw new Error('usage: --slug <slug> [--post]');
  const now = nowFrom(values.now);

  const bot = buildBotDeps(buildDeps(config));
  const [claim] = await bot.db
    .select({ author: claims.authorXUserId, status: claims.status, source: claims.sourceTweetId, summon: claims.summonTweetId })
    .from(claims)
    .where(eq(claims.slug, values.slug))
    .limit(1);
  if (!claim) throw new Error(`no claim ${values.slug}`);
  if (claim.status !== 'needs_info') throw new Error(`claim ${values.slug} is ${claim.status}; only a needs-info claim is re-judged`);

  // The author's own post, read again (its text is never stored), with the thread above it as context.
  const post = await bot.reader.readVersion(claim.source);
  // The posts above the author's own post are context: they name what the post only points at.
  const context: string[] = [];
  let parent = (await bot.x.getTweet(claim.source)).referenced_tweets?.find((ref) => ref.type === 'replied_to')?.id;
  for (let depth = 0; parent && depth < 3; depth++) {
    const above = await bot.x.getTweet(parent);
    context.unshift(above.text);
    parent = above.referenced_tweets?.find((ref) => ref.type === 'replied_to')?.id;
  }
  const result = await amendClaim(bot, { slug: values.slug, authorId: claim.author, text: post.text, now, context });
  printJson({ slug: values.slug, outcome: result.outcome, reply: result.reply });

  if (values.post && result.reply) {
    const reply = await bot.postReply(claim.summon, result.reply);
    printJson({ posted: reply.id });
  }
});
