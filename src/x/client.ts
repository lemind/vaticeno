import { z } from 'zod';

const X_API_BASE = 'https://api.x.com/2';

// Field names are the long-standing v2 ones. The current docs page shows `post.fields` /
// `referenced_posts`; if X rejects these, the 400 body names the valid values.
const MENTION_TWEET_FIELDS =
  'created_at,conversation_id,author_id,in_reply_to_user_id,referenced_tweets,edit_controls,edit_history_tweet_ids';

const XUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().optional(),
});

const MentionSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string(),
  conversation_id: z.string().optional(),
  created_at: z.string().optional(),
  in_reply_to_user_id: z.string().optional(),
  referenced_tweets: z
    .array(
      z.object({
        type: z.enum(['replied_to', 'quoted', 'retweeted']),
        id: z.string(),
      }),
    )
    .optional(),
  edit_history_tweet_ids: z.array(z.string()).optional(),
  edit_controls: z
    .object({ editable_until: z.string(), edits_remaining: z.number() })
    .optional(),
});

const MentionsResponseSchema = z.object({
  data: z.array(MentionSchema).optional(),
  includes: z.object({ users: z.array(XUserSchema).optional() }).optional(),
  meta: z.object({
    result_count: z.number(),
    newest_id: z.string().optional(),
    oldest_id: z.string().optional(),
    next_token: z.string().optional(),
  }),
});

const UserByUsernameResponseSchema = z.object({ data: XUserSchema });

// A suspended or deleted account answers 200 with `errors` and no `data`, so `data` is optional.
const UserMetricsResponseSchema = z.object({
  data: z
    .object({
      public_metrics: z.object({ followers_count: z.number().int().nonnegative() }),
    })
    .optional(),
});

// A pool account's latest posts (spec 002): own posts only, no replies or reposts, newest first.
// Every field is optional on purpose: X omits requested fields on withheld posts, and a gone or
// protected account answers 200 with `errors` and no `meta`. One odd post must not cost us the page.
const UserPostSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.string().optional(),
});
// A search result for the event repost (spec 005 FR-011): its account and its likes and reposts come free with it.
const SearchPostSchema = UserPostSchema.extend({
  author_id: z.string(),
  public_metrics: z.object({ like_count: z.number(), retweet_count: z.number() }),
});
const SearchResponseSchema = z.object({
  data: z.array(SearchPostSchema).optional(),
  meta: z.object({ result_count: z.number() }).optional(),
});

// Posts of one conversation, flat: what a person sees above a reply, which is not the same as its
// ancestors — an answer from another account can sit directly above without being the parent.
const ConversationResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        author_id: z.string().optional(),
        created_at: z.string().optional(),
      }),
    )
    .optional(),
  meta: z.object({ result_count: z.number() }).optional(),
});

// One post with its edit history; the last id in edit_history_tweet_ids is the current version.
const TweetResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    text: z.string(),
    author_id: z.string().optional(),
    edit_history_tweet_ids: z.array(z.string()).optional(),
    referenced_tweets: z
      .array(z.object({ type: z.string(), id: z.string() }))
      .optional(),
  }),
});

export type Mention = z.infer<typeof MentionSchema>;
export type UserPost = z.infer<typeof UserPostSchema>;
export type SearchPost = z.infer<typeof SearchPostSchema>;
export type XUser = z.infer<typeof XUserSchema>;
export type MentionsPage = z.infer<typeof MentionsResponseSchema>;

// The request never left this machine (no token to send it with, bad config): X cannot have seen it, so
// the caller may safely try again — unlike a failure after the request went out, which may have landed and
// must never be retried (INIT_SPEC §6.7). Only provably pre-flight failures may use this.
export class PostNotSent extends Error {
  constructor(readonly reason: unknown) {
    super(
      `post not sent: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  }
}

export class XApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly rateLimitResetAt: string | null,
  ) {
    super(`X API ${status}: ${body.slice(0, 500)}`);
  }
}

export function createXClient(bearerToken: string) {
  async function getJson(
    path: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(X_API_BASE + path);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const body = await res.text();
    if (!res.ok) {
      const reset = res.headers.get('x-rate-limit-reset');
      throw new XApiError(
        res.status,
        body,
        reset ? new Date(Number(reset) * 1000).toISOString() : null,
      );
    }
    return JSON.parse(body);
  }

  return {
    async getUserByUsername(username: string): Promise<XUser> {
      const json = await getJson(
        `/users/by/username/${encodeURIComponent(username)}`,
        {},
      );
      return UserByUsernameResponseSchema.parse(json).data;
    },

    // The account's follower count now; null when X returns no such account (004 T420).
    async getFollowerCount(userId: string): Promise<number | null> {
      const json = await getJson(`/users/${encodeURIComponent(userId)}`, {
        'user.fields': 'public_metrics',
      });
      return (
        UserMetricsResponseSchema.parse(json).data?.public_metrics.followers_count ??
        null
      );
    },

    // Recent search, newest first; billed per post returned, so `maxResults` is the cost ($0.005 each).
    async searchRecent(
      query: string,
      opts: { since: Date; maxResults: number },
    ): Promise<SearchPost[]> {
      const json = await getJson('/tweets/search/recent', {
        query,
        max_results: String(opts.maxResults),
        start_time: opts.since.toISOString().replace(/\.\d+Z$/, 'Z'),
        sort_order: 'recency',
        'tweet.fields': 'created_at,author_id,public_metrics',
      });
      return SearchResponseSchema.parse(json).data ?? [];
    },

    // Recent search over one conversation. X's smallest page is 10 and billing is per post returned, so
    // this costs ~10 post reads: the caller only asks when the cheap walk up the parents found nothing.
    // `untilId` buys the 10 posts before that one instead of the 10 newest in the thread — in a busy
    // conversation the posts that explain a prediction are the ones just before it, not the latest.
    async getConversation(
      conversationId: string,
      opts: { untilId?: string; maxResults?: number } = {},
    ): Promise<
      Array<{ id: string; text: string; created_at?: string; author_id?: string }>
    > {
      const params: Record<string, string> = {
        query: `conversation_id:${conversationId}`,
        max_results: String(opts.maxResults ?? 10),
        'tweet.fields': 'created_at,author_id',
      };
      if (opts.untilId) params.until_id = opts.untilId;
      const json = await getJson('/tweets/search/recent', params);
      return ConversationResponseSchema.parse(json).data ?? [];
    },

    async getTweet(
      id: string,
    ): Promise<z.infer<typeof TweetResponseSchema>['data']> {
      const json = await getJson(`/tweets/${encodeURIComponent(id)}`, {
        'tweet.fields': 'author_id,edit_history_tweet_ids,referenced_tweets',
      });
      return TweetResponseSchema.parse(json).data;
    },

    async getMentionsPage(opts: {
      userId: string;
      sinceId?: string;
      paginationToken?: string;
      maxResults: number;
    }): Promise<MentionsPage> {
      const params: Record<string, string> = {
        max_results: String(opts.maxResults),
        'tweet.fields': MENTION_TWEET_FIELDS,
        expansions: 'author_id',
        'user.fields': 'username',
      };
      if (opts.sinceId) params.since_id = opts.sinceId;
      if (opts.paginationToken) params.pagination_token = opts.paginationToken;
      const json = await getJson(`/users/${opts.userId}/mentions`, params);
      return MentionsResponseSchema.parse(json);
    },
  };
}

export type XClient = ReturnType<typeof createXClient>;

const CreatePostResponseSchema = z.object({
  data: z.object({ id: z.string(), text: z.string() }),
});

async function sendUserRequest(
  accessToken: string,
  method: 'GET' | 'POST',
  path: string,
  payload?: unknown,
) {
  const res = await fetch(X_API_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await res.text();
  if (!res.ok) {
    const reset = res.headers.get('x-rate-limit-reset');
    throw new XApiError(
      res.status,
      body,
      reset ? new Date(Number(reset) * 1000).toISOString() : null,
    );
  }
  return JSON.parse(body) as unknown;
}

// User-context calls take an OAuth 2.0 user access token, not the app Bearer token.
export async function getAuthenticatedUser(accessToken: string): Promise<XUser> {
  return UserByUsernameResponseSchema.parse(
    await sendUserRequest(accessToken, 'GET', '/users/me'),
  ).data;
}

// Own-feed posts (constitution VI 2.4.0, spec 002): only src/content/ may call these. Keep URLs out of
// `text`: a post with a link costs far more (§9 surcharge).
const RepostResponseSchema = z.object({
  data: z.object({ retweeted: z.boolean() }),
});

// A repost creates no post of ours, so X returns no id — only whether it took.
export async function repost(
  accessToken: string,
  meUserId: string,
  postId: string,
): Promise<boolean> {
  const json = await sendUserRequest(
    accessToken,
    'POST',
    `/users/${encodeURIComponent(meUserId)}/retweets`,
    { tweet_id: postId },
  );
  return RepostResponseSchema.parse(json).data.retweeted;
}

export async function quotePost(
  accessToken: string,
  quotedPostId: string,
  text: string,
) {
  const json = await sendUserRequest(accessToken, 'POST', '/tweets', {
    text,
    quote_tweet_id: quotedPostId,
  });
  return CreatePostResponseSchema.parse(json).data;
}

export async function postStandalone(
  accessToken: string,
  text: string,
  mediaIds: string[] = [],
) {
  const payload =
    mediaIds.length > 0 ? { text, media: { media_ids: mediaIds } } : { text };
  return CreatePostResponseSchema.parse(
    await sendUserRequest(accessToken, 'POST', '/tweets', payload),
  ).data;
}

const MediaUploadResponseSchema = z.object({ data: z.object({ id: z.string() }) });

export const MEDIA_UPLOAD_URL = `${X_API_BASE}/media/upload`;

// One image for an own post (spec 005 FR-024). `authorization` is the bot's OAuth 1.0a header for this URL, or
// `Bearer <token>` for a 2.0 token with `media.write`. Returns the media id.
// UNRECONCILED: not yet called with our keys; the first event post with a poster is the check. Any failure leaves
// the post as text (src/content/wire.ts).
export async function uploadImage(
  authorization: string,
  png: Buffer,
): Promise<string> {
  const form = new FormData();
  form.append(
    'media',
    new Blob([new Uint8Array(png)], { type: 'image/png' }),
    'poster.png',
  );
  form.append('media_category', 'tweet_image');
  const res = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: authorization },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new XApiError(res.status, body, null);
  return MediaUploadResponseSchema.parse(JSON.parse(body)).data.id;
}

// Always a reply in the thread, never a standalone post (INIT_SPEC §6.5). Keep URLs out: §9 surcharge.
export async function postReply(
  accessToken: string,
  inReplyToTweetId: string,
  text: string,
) {
  const json = await sendUserRequest(accessToken, 'POST', '/tweets', {
    text,
    reply: { in_reply_to_tweet_id: inReplyToTweetId },
  });
  return CreatePostResponseSchema.parse(json).data;
}
