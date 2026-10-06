# Implementation Plan: Content feed

**Branch**: `002-content-feed` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

## Summary

A small, cheap feed. Twice a day: pick one pool account by weight → read its latest posts → repost the
latest eligible one (9 in 10) or quote it with a verified quote or an AI joke (1 in 10). Owner-written originals post
from a queue with no AI. Receipts quote the bot's own verdict replies. Dry-run first.

## Technical Context

Same stack as 001: Node 22, TypeScript, Drizzle + Supabase Postgres, node-cron in the one service,
Gemini flash-lite, X API v2 (pay-per-use). No new dependencies.

## Constitution Check

- **VI (replies only where mentioned)**: own-feed posts are a new kind of activity. Needs an amendment
  before posting is switched on: "Own-feed posts allowed: pool reposts and quote posts, owner-written
  originals, receipts; capped per day; no @mentions, links or hashtags in our text; dry-run by default."
  **Blocking.**
- **No post text stored (FR-009)**: only pool post ids and handles are stored; a post's text stays in
  memory for the one AI call on quote turns.
- **Cheaper models first, structured output, Zod at boundaries**: at most one flash-lite call per quote
  turn (~6 a month), JSON.
- **KISS**: one job file, a few tables, a config list. No queue system, no extra service.

## Run flow

```
pool run (2×/day, random minute in a morning and an evening window)
  pick an account by weight (weight / sum), not the previous run's account
  → GET /2/users/:id/tweets  exclude=replies,retweets  max_results=5 (X's minimum)  → take the newest
  → newest post ≤ 48 h old and not in feed_posts (the latest eligible one) → none: pick again
    (≤ 3 tries, else stop)
  → roll: 90% repost | 5% quote + verified quote | 5% quote + AI joke
      repost:  reserve slot → POST /2/users/:me/retweets
      quote:   feed.v1 (one call): topic for the quote source, or the joke → checks → reserve slot →
               POST /2/tweets with quote_tweet_id; no quote / failed checks → plain repost
original (1×/day)       next queue item → reserve slot → post
receipts (hourly, ≤ 2/day)  new verdict replies, author not STOPped → reserve → quote post
```

Verified quote: the AI names a topic that fits the post (from the `quote` command's topics); the quote
itself comes from the existing checked source (`wikiquoteQuote`), never from the AI. Joke checks in code:
≤ 200 characters as X counts them, `hasTagsOrLinks` false; the instructions forbid predictions of its
own and new facts.

## Pool and weights

`src/content/pool.ts` holds the 15 accounts with numeric id, handle and weight (table and scores in
`docs/content-rules.md`). The owner-kept platform account's id comes from an env var. Weight = score − 15;
chance = weight / 144. Top accounts (Romano, Schefter: 10.4%) come up about 4× as often as the weakest
(Statsbomb, Manifold: 2.8%). Ids, not handles: the ids are looked up once at setup (T003, ~$0.16), never again at run time.

## Cost

Prices UNRECONCILED (X pricing page: $0.005 per post read, $0.015 per post created; repost price to be
measured).

| Part | Per day | Per month |
|---|---|---|
| Reads: 2 runs × 5 posts (X's minimum page), rarely a retry | ~10 | ~$1.50 |
| Reposts / quote posts | 2 | ~$0.90 |
| AI: quote turns only | ~0.2 | < $0.01 |
| Originals 1/day + receipts ≤ 2/day | 1–3 | ~$0.45–1.35 |

Pool part ~$2.40 a month; whole feed ~$2.85–3.75 at full caps (under $4, SC-002), with reposts priced
like posts until measured.

## Project Structure

```
src/content/
  pool.ts          the pool (id, handle, field, weight, enabled), weighted pick
  eligible.ts      latest eligible post (pure)
  quote.ts         the quote turn: feed.v1 call (src/llm/instructions/feed.v1.md), quote source, checks
  slots.ts         slot reservation, posted/failed marks, daily spend cap
  pool-run.ts      the pool run (dry run logs only)
  original-run.ts  the daily original
  receipt-run.ts   receipts
src/cli/content-tick.ts, src/cli/content-queue.ts   run one job by hand; manage the originals queue
src/jobs/scheduler.ts   pool (2×/day), original (daily), receipts (hourly), only with ENABLE_FEED
drizzle/0010_feed.sql, 0011_feed_dry_run.sql   feed_posts (kind, cap_group generated, status, day, slot,
                        source_post_id, account_id, queue_item_id, posted_id, created_at),
                        feed_queue (text, position, posted_at)
```

X client additions: user timeline read, repost (`POST /2/users/:id/retweets`), quote post (`POST /2/tweets`
with `quote_tweet_id`). Following the pool: by hand in the app (free), or the API with the extra
`follows.write` permission (re-authorize the bot). Config: `ENABLE_FEED` (off), `FEED_DRY_RUN` (on),
`FEED_PLATFORM_ACCOUNT_ID` (the owner-kept account), `FEED_DAILY_USD_CAP` (0.30). The feed's model call never uses grounded search: the surcharge would be filed as `search` by the shared
client and stay invisible to the daily cap. X and model costs are recorded
as cost rows (provider `x`; operations `feed_read`, `feed_post`, `feed_model`), and the daily cap sums
exactly those. X list prices: `src/x/prices.ts`.

## Never twice, caps (database-enforced)

- `feed_posts` has `status` (`reserved → posted | failed`), a unique key on `source_post_id` (when set)
  and on `(cap group, day, slot)`, where reposts and quote posts share the `pool` group; slots are 1–2 for
  pool posts, 1 for original, 1–2 for receipts.
- Posting = insert the row first with the first free slot (`on conflict do nothing`; no row → skip),
  then post, then store the posted id and `posted`. Same rule as replies: marked before posting, never
  retried (INIT_SPEC §6.7).
- X rejects the post → `failed` and `slot = null`: the source stays used (one attempt per post), the
  slot is free again (null is outside the unique key), so caps count only `reserved` and `posted`.
- A crash between posting and storing leaves `reserved`: the slot stays taken and the post is not retried
  (the post may have gone out).
- A dry-run pick is stored as a `dry_run` row with no slot: it holds none of the day's cap, yet it keeps
  the rehearsal honest (the same account never twice in a row, the same post never twice).

## The `quote` command's topic (phase 7)

A quote is always returned; the topic only decides which Wikiquote page is searched first. The cascade is
keywords (free) → one flash-lite call on the request text (~$0.0002) → the parent post, but only when
that answered nothing (+$0.005) → two more posts above, only if the parent did not settle it (+$0.010) →
a random topic, as today. About $0.0012 per quote on the estimated shares (10% reach the parent, 5% the
thread), i.e. ~$0.19 a month at 5 quotes a day. Each quote logs which step decided it, so the shares get
measured instead of assumed.

## Phases

1. **Constitution amendment** (VI), pool with ids and weights in config, follow the pool.
2. **Pool, live**: `ENABLE_FEED=true`, `FEED_DRY_RUN=false` on the server (owner decision: no rehearsal
   week — the daily caps and a hand-deleted post are the safety net). The first `cost_events` rows give
   the real X prices (SC-002); the logged picks are read as they happen (SC-001).
4. **Originals queue**: table + CLI to add items; daily slot.
5. **Receipts**: quote the bot's own verdict replies.

## Risks

- The latest post is reposted without an AI check: a news or off-topic post can land on the feed. The
  dry run shows how often; lower an account's weight or drop it if needed.
- Busy accounts (Romano, Schefter) post constantly; their latest post is often plain news, not a
  prediction. Accepted: the reach is the point.
- A pool account that X reports as gone (suspended, protected, or deleted): skipped for the run,
  one alert a day, the rest continue.
- Political accounts can tilt the feed: their weights are moderate and the owner can disable one.
