// Builds the X side of the bot from the X env (src/config.ts loadConfig): client, post reader, reply poster.
import { loadConfig } from '../config.js';
import type { ClaimDeps } from '../lifecycle/claims.js';
import { log } from '../log.js';
import { createXClient, postReply, XApiError } from '../x/client.js';
import { getValidAccessToken } from '../x/oauth.js';
import type { BotDeps } from './mentions.js';
import { createXSourceReader } from './x-source-reader.js';

export function buildBotDeps(claimDeps: ClaimDeps): BotDeps {
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
    postReply: async (inReplyTo, text) => {
      try {
        return await postReply(await getValidAccessToken(creds), inReplyTo, text);
      } catch (error) {
        if (!(error instanceof XApiError) || error.status !== 401) throw error;
        log('warn', 'reply got 401; refreshing the token once', { event: 'reply.token_refresh', tweet_id: inReplyTo });
        return postReply(await getValidAccessToken(creds, { forceRefresh: true }), inReplyTo, text);
      }
    },
  };
}
