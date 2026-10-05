# Implementation Plan: Content feed

**Branch**: `002-content-feed` (not created yet) | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

## Summary

A cheap, mostly deterministic feed: a scheduler job reads a few pool accounts per run, filters posts in
code, makes at most one model call to pick a concrete prediction, and quote-posts it with a fixed line.
Owner-written originals post from a queue with no AI. Receipts quote the bot's own verdict replies.
Dry-run first. The design goal is cost: every step that can be code is code.

## Technical Context

Same stack as 001: Node 22, TypeScript, Drizzle + Supabase Postgres, node-cron in the one service,
Gemini flash-lite, X API v2 (pay-per-use). No new dependencies.

## Constitution Check

- **VI (replies only where mentioned)**: own-feed posts are a new kind of activity. Needs an amendment
  before posting is switched on: "Own-feed posts allowed: spotted quote posts, owner-written originals,
  receipts; capped per day; no @mentions, links or hashtags in our text; dry-run by default." **Blocking.**
- **No post text stored (FR-029)**: only pool post ids and handles are stored; candidate texts stay in
  memory for the one model call.
- **Cheaper models first, structured output, Zod at boundaries**: one flash-lite call per run, JSON.
- **KISS**: one job file, two tables, a config list. No queue system, no extra service.

## Cost design (the point of this feature)

| Step | How it stays cheap |
|---|---|
| Reading X | 3–4 pool accounts per run (rotating), `since_id` per account, `max_results` 5, no replies or reposts requested (`exclude=replies,retweets`) → about 30–40 post reads a day |
| Filtering | in code: age ≤ 48 h, has a number / date / future marker, not about betting calls → most posts never reach the model |
| Choosing | one flash-lite call per run over all remaining candidates (batched), skipped when no candidate survives the filters |
| Writing | fixed lines from a list: no model call |
| Originals | owner-written queue: no model call, no reads |
| Receipts | our own data: no reads, no model call |
| Guard | daily spend cap from recorded costs; the feed stops for the day when reached |

Rough monthly cost at 2 runs a day: model under $0.10; X reads and posts dominate. X's per-read and
per-post prices are UNRECONCILED; measure in the dry run before switching posting on.

## Project Structure

```
src/feed/
  pool.ts        the pool list (handle, field), rotation, per-account cursor
  filter.ts      code filters (pure, unit-tested)
  select.ts      the one model call (instructions: src/llm/instructions/spot.v1.md)
  post.ts        quote post / original / receipt, caps, dry-run
  job.ts         the scheduler entry: spotted (2×/day), original (1×/day), receipts (hourly)
drizzle/00NN_feed.sql   feed_posts (kind, source_post_id, posted_id, at), feed_queue (text, order, posted_at),
                        pool cursors (handle, last_post_id)
```

X client additions: user timeline read (`GET /2/users/:id/tweets` with `since_id`, `exclude`), quote post
(`POST /2/tweets` with `quote_tweet_id`). Config: `ENABLE_FEED` (off), `FEED_DRY_RUN` (on), caps.

## Phases

1. **Constitution amendment** (VI) and pool list in config. No code posts yet.
2. **Spotted, dry run**: reader + filters + selector + logging of chosen candidates; costs recorded.
   Run two weeks, owner reviews picks (SC-001), measure X read cost (SC-002).
3. **Spotted, live**: quote posts behind `FEED_DRY_RUN=false`, caps on.
4. **Originals queue**: table + CLI to add items; daily slot.
5. **Receipts**: quote the bot's own verdict replies.

## Risks

- X read pricing may make even 40 reads a day noticeable: lower to 1 run a day or fewer accounts.
- Political accounts in the pool (forecasting/statistics) can tilt the feed: the selector prefers sport,
  crypto and tech when scores tie, and the owner can disable an account in config.
- A wrong pick is public: dry-run first, and only fixed text of our own.
