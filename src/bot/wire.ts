// Builds the X side of the bot from the X env (src/config.ts loadConfig): client, post reader, reply poster.
import { loadConfig } from '../config.js';
import type { ExtrasDeps } from './extras.js';
import { log } from '../log.js';
import { createXClient, PostNotSent, postReply, XApiError } from '../x/client.js';
import { humanDates, weightedLength, X_MAX_CHARS } from '../replies/templates.js';
import { getValidAccessToken } from '../x/oauth.js';
import type { BotDeps } from './mentions.js';
import { createXSourceReader } from './x-source-reader.js';

export function buildBotDeps(claimDeps: ExtrasDeps): BotDeps {
  const config = loadConfig();
  if (!config.X_BOT_USER_ID) throw new Error('X_BOT_USER_ID is missing. Run `npm run poc:whoami` first.');
  if (!config.X_OAUTH2_CLIENT_ID || !config.X_OAUTH2_CLIENT_SECRET) throw new Error('X_OAUTH2_CLIENT_ID/SECRET are needed to post replies');
  const creds = { clientId: config.X_OAUTH2_CLIENT_ID, clientSecret: config.X_OAUTH2_CLIENT_SECRET, redirectUri: config.X_OAUTH2_REDIRECT_URI };
  const allow = new Set(config.REPLY_ALLOWLIST_USER_IDS);
  const x = createXClient(config.X_BEARER_TOKEN);

  return {
    ...claimDeps,
    x,
    reader: createXSourceReader(x),
    botUserId: config.X_BOT_USER_ID,
    allowAuthor: (authorId) => allow.has('*') || allow.has(authorId),
    caps: { perAuthorPerHour: config.REPLY_MAX_PER_AUTHOR_PER_HOUR, perDay: config.REPLY_MAX_PER_DAY },
    // HACK(x): SPECULATIVE — a 401 can mean a stale stored expiry: refresh once and retry (the token rotates). See src/x/oauth.ts.
    // REVISIT: if 401s after a refresh show up in Sentry, the stored token is broken, not stale.
    postReply: async (inReplyTo, replyText) => {
      // One place for every reply (mentions, fixes, verdicts): ISO dates become "16 Oct 2026", unless
      // that would push the reply over X's limit, in which case the shorter ISO form stands.
      const human = humanDates(replyText);
      const text = weightedLength(human) <= X_MAX_CHARS ? human : replyText;
      const token = await accessToken(creds);
      try {
        return await postReply(token, inReplyTo, text);
      } catch (error) {
        if (!(error instanceof XApiError) || error.status !== 401) throw error;
        log('warn', 'reply got 401; refreshing the token once', { event: 'reply.token_refresh', tweet_id: inReplyTo });
        return postReply(await accessToken(creds, { forceRefresh: true }), inReplyTo, text);
      }
    },
  };
}

// No token, no request: the live defect of 2026-10-06/07, when the token file became unreadable and every
// caller treated "never sent" as "may have landed". PostNotSent says it provably did not, so the caller
// can try again instead of dropping the reply (INIT_SPEC §6.7 only forbids retrying an uncertain post).
export async function accessToken(creds: Parameters<typeof getValidAccessToken>[0], opts?: { forceRefresh: boolean }): Promise<string> {
  try {
    return await getValidAccessToken(creds, opts);
  } catch (error) {
    throw new PostNotSent(error);
  }
}
