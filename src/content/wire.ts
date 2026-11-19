// Builds the X side of the own feed (spec 002): timeline reads on the app token, reposts and quote posts
// on the bot's user token. Separate from src/bot/wire.ts so feed posting stays out of the reply path.
import { loadConfig, type CoreConfig } from '../config.js';
import { log } from '../log.js';
import {
  createXClient,
  postStandalone,
  quotePost,
  repost,
  MEDIA_UPLOAD_URL,
  uploadImage,
  XApiError,
} from '../x/client.js';
import { oauth1Header, type OAuth1Keys } from '../x/oauth1.js';
import { recordCost } from '../db/costs.js';
import { generateImage } from '../llm/image.js';
import type { CallCost } from '../llm/client.js';
import { X_MEDIA_UPLOAD_USD } from '../x/prices.js';
import { posterPrompt } from './event-image.js';
import type { FoundEvent } from './event-check.js';
import { saveCosts } from './quote.js';
import { accessToken } from '../bot/wire.js';
import { tokenScopes } from '../x/oauth.js';
import type { ContentDeps } from './pool-run.js';
import type { QuoteDeps } from './quote.js';
import type { PageFetcher } from '../resolve/fetch.js';

export function buildContentDeps(
  quoteDeps: QuoteDeps & { fetchPage: PageFetcher },
  core: CoreConfig,
): ContentDeps & {
  postText: (text: string, image?: Buffer) => Promise<{ id: string }>;
  fetchPage: PageFetcher;
  makePoster?: (topicId: string, event: FoundEvent) => Promise<Buffer | null>;
  drawPoster?: (prompt: string) => Promise<Buffer | null>;
} {
  const config = loadConfig();
  if (!config.X_BOT_USER_ID)
    throw new Error('X_BOT_USER_ID is missing. Run `npm run poc:whoami` first.');
  if (!config.X_OAUTH2_CLIENT_ID || !config.X_OAUTH2_CLIENT_SECRET)
    throw new Error('X_OAUTH2_CLIENT_ID/SECRET are needed to post');
  const oauth1: OAuth1Keys | null =
    config.X_API_KEY &&
    config.X_API_KEY_SECRET &&
    config.X_ACCESS_TOKEN &&
    config.X_ACCESS_TOKEN_SECRET
      ? {
          consumerKey: config.X_API_KEY,
          consumerSecret: config.X_API_KEY_SECRET,
          token: config.X_ACCESS_TOKEN,
          tokenSecret: config.X_ACCESS_TOKEN_SECRET,
        }
      : null;
  const creds = {
    clientId: config.X_OAUTH2_CLIENT_ID,
    clientSecret: config.X_OAUTH2_CLIENT_SECRET,
    redirectUri: config.X_OAUTH2_REDIRECT_URI,
  };
  const botUserId = config.X_BOT_USER_ID;
  const x = createXClient(config.X_BEARER_TOKEN);

  // HACK(x): SPECULATIVE — a 401 can mean a stale stored expiry: refresh once and retry (the token
  // rotates), the same way replies do. See src/x/oauth.ts and src/bot/wire.ts.
  // REVISIT: if 401s after a refresh show up in Sentry, the stored token is broken, not stale.
  const withToken = async <T>(
    call: (token: string) => Promise<T>,
    event: string,
  ): Promise<T> => {
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
    searchPosts: (query, since) => x.searchRecent(query, { since, maxResults: 10 }),
    repost: (postId) =>
      withToken(
        (token) => repost(token, botUserId, postId),
        'feed.repost_token_refresh',
      ),
    quotePost: (postId, text) =>
      withToken(
        (token) => quotePost(token, postId, text),
        'feed.quote_token_refresh',
      ),
    postText: (text, image) =>
      withToken(async (token) => {
        const mediaIds: string[] = [];
        if (image) {
          // A failed upload never stops the post: it goes out as text (005 FR-024).
          try {
            const authorization = oauth1
              ? oauth1Header('POST', MEDIA_UPLOAD_URL, oauth1)
              : `Bearer ${token}`;
            mediaIds.push(await uploadImage(authorization, image));
            await recordCost(quoteDeps.db, {
              claimId: null,
              provider: 'x',
              operation: 'feed_post',
              usdCost: X_MEDIA_UPLOAD_USD,
            });
          } catch (error) {
            log('warn', 'poster upload failed; posting the text alone', {
              event: 'feed.poster_upload_failed',
              error: String(error),
            });
          }
        }
        return postStandalone(token, text, mediaIds);
      }, 'feed.post_token_refresh'),
    dryRun: core.FEED_DRY_RUN,
    dailyUsdCap: core.FEED_DAILY_USD_CAP,
    showAuthorIds: core.FEED_SHOW_AUTHOR_IDS,
    fetchPage: quoteDeps.fetchPage,
    ...(core.LLM_MODE === 'live' && core.GEMINI_API_KEY
      ? posterMakers(quoteDeps, core.GEMINI_API_KEY, oauth1 !== null)
      : {}),
  };
}

// The event and race posters: one image call, its cost recorded whether or not an image came back. Nothing is
// generated (or paid for) until the bot's saved login can upload media.
function posterMakers(deps: QuoteDeps, apiKey: string, hasOAuth1: boolean) {
  const drawPoster = async (prompt: string): Promise<Buffer | null> => {
    if (!hasOAuth1 && !(await tokenScopes()).includes('media.write')) {
      log('info', 'no poster: no 1.0a keys and the bot login lacks media.write', {
        event: 'feed.poster_no_scope',
      });
      return null;
    }
    try {
      const { png, costs } = await generateImage(apiKey, prompt);
      await saveCosts(deps, costs);
      return png;
    } catch (error) {
      await saveCosts(deps, (error as { costs?: CallCost[] }).costs ?? []);
      throw error;
    }
  };
  return {
    drawPoster,
    makePoster: (topicId: string, event: FoundEvent) =>
      drawPoster(posterPrompt(topicId, event)),
  };
}
