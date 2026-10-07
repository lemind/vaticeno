// Builds the X side of the own feed (spec 002): timeline reads on the app token, reposts and quote posts
// on the bot's user token. Separate from src/bot/wire.ts so feed posting stays out of the reply path.
import { loadConfig, type CoreConfig } from '../config.js';
import { log } from '../log.js';
import { createXClient, postStandalone, quotePost, repost, XApiError } from '../x/client.js';
import { accessToken } from '../bot/wire.js';
import type { ContentDeps } from './pool-run.js';
import type { QuoteDeps } from './quote.js';

export function buildContentDeps(quoteDeps: QuoteDeps, core: CoreConfig): ContentDeps & { postText: (text: string) => Promise<{ id: string }> } {
  const config = loadConfig();
  if (!config.X_BOT_USER_ID) throw new Error('X_BOT_USER_ID is missing. Run `npm run poc:whoami` first.');
  if (!config.X_OAUTH2_CLIENT_ID || !config.X_OAUTH2_CLIENT_SECRET) throw new Error('X_OAUTH2_CLIENT_ID/SECRET are needed to post');
  const creds = { clientId: config.X_OAUTH2_CLIENT_ID, clientSecret: config.X_OAUTH2_CLIENT_SECRET, redirectUri: config.X_OAUTH2_REDIRECT_URI };
  const botUserId = config.X_BOT_USER_ID;
  const x = createXClient(config.X_BEARER_TOKEN);

  // HACK(x): SPECULATIVE — a 401 can mean a stale stored expiry: refresh once and retry (the token
  // rotates), the same way replies do. See src/x/oauth.ts and src/bot/wire.ts.
  // REVISIT: if 401s after a refresh show up in Sentry, the stored token is broken, not stale.
  const withToken = async <T>(call: (token: string) => Promise<T>, event: string): Promise<T> => {
    const token = await accessToken(creds); // unreadable token file → PostNotSent, so the slot is released
    try {
      return await call(token);
    } catch (error) {
      if (!(error instanceof XApiError) || error.status !== 401) throw error;
      log('warn', 'feed call got 401; refreshing the token once', { event });
      return call(await accessToken(creds, { forceRefresh: true }));
    }
  };

  return {
    ...quoteDeps,
    readPosts: (accountId) => x.getUserPosts(accountId),
    repost: (postId) => withToken((token) => repost(token, botUserId, postId), 'feed.repost_token_refresh'),
    quotePost: (postId, text) => withToken((token) => quotePost(token, postId, text), 'feed.quote_token_refresh'),
    postText: (text) => withToken((token) => postStandalone(token, text), 'feed.post_token_refresh'),
    dryRun: core.FEED_DRY_RUN,
    dailyUsdCap: core.FEED_DAILY_USD_CAP,
    platformAccountId: core.FEED_PLATFORM_ACCOUNT_ID,
  };
}
