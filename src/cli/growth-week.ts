// npm run growth:week [-- --quotes N] [--now <ISO>] — the Friday review's database half (spec 005 US6): free, no
// X or model call. The owner adds the hand-made quote posts from X's dashboard; without them no share is claimed.
import { and, gte, lt, sql } from 'drizzle-orm';
import { claims, feedPosts } from '../db/schema.js';
import { getDb } from '../db/client.js';
import { cliArgs, nowFrom, printJson, runCli } from './run.js';

const DAY_MS = 86_400_000;
const OWN = ['original', 'digest', 'record', 'event'] as const;

await runCli('growth-week', async (config) => {
  const { values } = cliArgs({
    now: { type: 'string' },
    quotes: { type: 'string' },
  });
  const now = nowFrom(values.now);
  const db = getDb();
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const owner = new Set(config.FEED_SHOW_AUTHOR_IDS);

  const authors = await db
    .select({
      author: claims.authorXUserId,
      first: sql<Date>`min(${claims.createdAt})`,
    })
    .from(claims)
    .groupBy(claims.authorXUserId);
  const weekly = await db
    .select({ author: claims.authorXUserId, n: sql<number>`count(*)::int` })
    .from(claims)
    .where(and(gte(claims.createdAt, since), lt(claims.createdAt, now)))
    .groupBy(claims.authorXUserId);
  const active = weekly.filter((a) => !owner.has(a.author));
  const firstTime = authors.filter(
    (a) =>
      !owner.has(a.author) && new Date(a.first) >= since && new Date(a.first) < now,
  );

  const posts = async (from: Date) =>
    db
      .select({ kind: feedPosts.kind, n: sql<number>`count(*)::int` })
      .from(feedPosts)
      .where(
        and(
          sql`${feedPosts.status} = 'posted'`,
          gte(feedPosts.day, from.toISOString().slice(0, 10)),
        ),
      )
      .groupBy(feedPosts.kind);
  const week = Object.fromEntries((await posts(since)).map((p) => [p.kind, p.n]));
  const fourWeeks = await posts(new Date(now.getTime() - 28 * DAY_MS));
  const own4 = fourWeeks
    .filter((p) => (OWN as readonly string[]).includes(p.kind))
    .reduce((s, p) => s + p.n, 0);
  const reposts4 = fourWeeks
    .filter((p) => p.kind === 'repost')
    .reduce((s, p) => s + p.n, 0);
  const quotes = values.quotes === undefined ? null : Number(values.quotes);
  if (quotes !== null && !(Number.isInteger(quotes) && quotes >= 0))
    throw new Error('--quotes takes a whole number');

  printJson({
    week: {
      from: since.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    },
    claims_recorded: weekly.reduce((s, a) => s + a.n, 0),
    active_authors: active.length,
    first_time_authors: firstTime.length,
    posts_this_week: week,
    own_share_4_weeks:
      quotes === null
        ? 'needs --quotes N, the hand-made quote posts from X'
        : Number(
            ((own4 + quotes) / Math.max(own4 + quotes + reposts4, 1)).toFixed(2),
          ),
    also_read: [
      'X dashboard: followers, profile visits, impressions',
      'Cloudflare Web Analytics: host vaticeno.n30sk.cc',
    ],
  });
});
