import { z } from 'zod';

const X_API_BASE = 'https://api.x.com/2';

// Field names are the long-standing v2 ones. The current docs page shows `post.fields` /
// `referenced_posts`; if X rejects these, the 400 body names the valid values.
const MENTION_TWEET_FIELDS = 'created_at,conversation_id,author_id,in_reply_to_user_id,referenced_tweets,edit_controls,edit_history_tweet_ids';

const XUserSchema = z.object({ id: z.string(), username: z.string(), name: z.string().optional() });

const MentionSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string(),
  conversation_id: z.string().optional(),
  created_at: z.string().optional(),
  in_reply_to_user_id: z.string().optional(),
  referenced_tweets: z
    .array(z.object({ type: z.enum(['replied_to', 'quoted', 'retweeted']), id: z.string() }))
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

// A pool account's latest posts (spec 002): own posts only, no replies or reposts, newest first.
// Every field is optional on purpose: X omits requested fields on withheld posts, and a gone or
// protected account answers 200 with `errors` and no `meta`. One odd post must not cost us the page.
const UserPostSchema = z.object({ id: z.string(), text: z.string(), created_at: z.string().optional() });
const UserPostsResponseSchema = z.object({
  data: z.array(UserPostSchema).optional(),
  meta: z.object({ result_count: z.number() }).optional(),
});

// One post with its edit history; the last id in edit_history_tweet_ids is the current version.
const TweetResponseSchema = z.object({
  data: z.object({
    id: z.string(), text: z.string(), author_id: z.string().optional(), edit_history_tweet_ids: z.array(z.string()).optional(),
    referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
  }),
});

export type Mention = z.infer<typeof MentionSchema>;
export type UserPost = z.infer<typeof UserPostSchema>;
export type XUser = z.infer<typeof XUserSchema>;
export type MentionsPage = z.infer<typeof MentionsResponseSchema>;

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
  async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(X_API_BASE + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` } });
    const body = await res.text();
    if (!res.ok) {
      const reset = res.headers.get('x-rate-limit-reset');
      throw new XApiError(res.status, body, reset ? new Date(Number(reset) * 1000).toISOString() : null);
    }
    return JSON.parse(body);
  }

  return {
    async getUserByUsername(username: string): Promise<XUser> {
      const json = await getJson(`/users/by/username/${encodeURIComponent(username)}`, {});
      return UserByUsernameResponseSchema.parse(json).data;
    },

    // X's smallest timeline page is 5 posts, and billing is per post returned (src/x/prices.ts).
    async getUserPosts(userId: string): Promise<UserPost[]> {
      const json = await getJson(`/users/${encodeURIComponent(userId)}/tweets`, {
        max_results: '5',
        exclude: 'replies,retweets',
        'tweet.fields': 'created_at',
      });
      return UserPostsResponseSchema.parse(json).data ?? [];
    },

    async getTweet(id: string): Promise<z.infer<typeof TweetResponseSchema>['data']> {
      const json = await getJson(`/tweets/${encodeURIComponent(id)}`, { 'tweet.fields': 'author_id,edit_history_tweet_ids,referenced_tweets' });
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

const CreatePostResponseSchema = z.object({ data: z.object({ id: z.string(), text: z.string() }) });

async function sendUserRequest(accessToken: string, method: 'GET' | 'POST', path: string, payload?: unknown) {
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
    throw new XApiError(res.status, body, reset ? new Date(Number(reset) * 1000).toISOString() : null);
  }
  return JSON.parse(body) as unknown;
}

// User-context calls take an OAuth 2.0 user access token, not the app Bearer token.
export async function getAuthenticatedUser(accessToken: string): Promise<XUser> {
  return UserByUsernameResponseSchema.parse(await sendUserRequest(accessToken, 'GET', '/users/me')).data;
}

// Own-feed posts (constitution VI 2.4.0, spec 002): only src/content/ may call these. Keep URLs out of
// `text`: a post with a link costs far more (§9 surcharge).
const RepostResponseSchema = z.object({ data: z.object({ retweeted: z.boolean() }) });

// A repost creates no post of ours, so X returns no id — only whether it took.
export async function repost(accessToken: string, meUserId: string, postId: string): Promise<boolean> {
  const json = await sendUserRequest(accessToken, 'POST', `/users/${encodeURIComponent(meUserId)}/retweets`, { tweet_id: postId });
  return RepostResponseSchema.parse(json).data.retweeted;
}

export async function quotePost(accessToken: string, quotedPostId: string, text: string) {
  const json = await sendUserRequest(accessToken, 'POST', '/tweets', { text, quote_tweet_id: quotedPostId });
  return CreatePostResponseSchema.parse(json).data;
}

export async function postStandalone(accessToken: string, text: string) {
  return CreatePostResponseSchema.parse(await sendUserRequest(accessToken, 'POST', '/tweets', { text })).data;
}

// Always a reply in the thread, never a standalone post (INIT_SPEC §6.5). Keep URLs out: §9 surcharge.
export async function postReply(accessToken: string, inReplyToTweetId: string, text: string) {
  const json = await sendUserRequest(accessToken, 'POST', '/tweets', {
    text,
    reply: { in_reply_to_tweet_id: inReplyToTweetId },
  });
  return CreatePostResponseSchema.parse(json).data;
}
