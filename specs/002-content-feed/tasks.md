# Tasks: Content feed

**Input**: [spec.md](spec.md), [plan.md](plan.md), `docs/content-rules.md` (pool and weights)

**Tests**: minimal, only where a bug would post twice, post too much or post bad text: the weighted pick,
slot reservation / never-twice, and the text checks. Nothing else gets a test.

**Paths**: new code in `src/content/` (the plan's `src/feed/`, renamed: `src/feeds/` already holds the
price feeds). Commits: `feat(002-T0NN): …`, one line.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Amend constitution VI (2.3.0 → 2.4.0) in `.specify/memory/constitution.md`: own-feed posts allowed — pool reposts and quote posts, owner-written originals, receipts; capped per day; no @mentions, links or hashtags in text we add; no prediction of our own; dry-run by default. Update the version in `CLAUDE.md` and the "Replies only where mentioned" line there. **Blocks every posting task.**
- [x] T002 [P] Add config in `src/config.ts`: `ENABLE_FEED` (default false), `FEED_DRY_RUN` (default true), `FEED_PLATFORM_ACCOUNT_ID` (optional numeric id of the owner-kept platform account), `FEED_DAILY_USD_CAP` (default 0.30); document them in `.env.example`.
- [x] T003 [P] Look up the numeric X ids of the 15 named pool accounts once (paid, ~$0.16, owner approves) and write them into `src/content/pool.ts` (T006). **Done 2026-10-05**: `npm run content:pool-ids` resolved all 16 into the generated `src/content/pool-ids.ts` (`@ESPNStatsInfo` dropped afterwards — the handle now carries a betting brand — and `@_1woonomic` as dormant, so 14 remain) ($0.17 — Kalshi needed one retry after a transient 520 from X). The platform account stays configured by id.

**Phase 1 done** (T001–T002): constitution 2.4.0 amends IV and VI for own-feed posts (capped, dry-run by
default; no @mentions, links, hashtags or predictions of our own in text we add); `CLAUDE.md` carries the
same rule. Config adds `ENABLE_FEED` (off), `FEED_DRY_RUN` (on), `FEED_PLATFORM_ACCOUNT_ID`,
`FEED_DAILY_USD_CAP` (0.30), documented in `.env.example`; `ENABLE_FEED` without `ENABLE_JOBS` is a config
error now, not a silent no-op. The id lookup records no cost row yet — provider `x` arrives with T005, so
the CLI only prints the estimate.

---

## Phase 2: Foundational

- [x] T004 Migration `drizzle/0010_feed.sql` + `src/db/schema.ts`: table `feed_posts` (id, kind `repost|quote|original|receipt`, status `reserved|posted|failed`, day date, slot int null, source_post_id text null, account_id text null, queue_item_id null, posted_id text null, created_at) with unique `(source_post_id)` where not null and unique `(kind_group, day, slot)` where `kind_group` is `pool` for repost/quote, else the kind; table `feed_queue` (id, text, position, posted_at null); RLS on, no policies; a down migration. Apply locally, then on Supabase.
- [x] T005 Add X cost rows: provider `x`, operations `read`, `post`, `repost` in `src/db/schema.ts` (`COST_PROVIDERS`, `COST_OPERATIONS`, CHECK constraint in T004's migration); prices in `src/llm/prices.ts` marked UNRECONCILED ($0.005 read, $0.015 post, repost = post until measured).
- [x] T006 [P] `src/content/pool.ts`: the 15 accounts (id, handle, field, weight = score − 15, enabled) from `docs/content-rules.md`; the platform account's id from `FEED_PLATFORM_ACCOUNT_ID` (skipped when unset); `pickAccount(pool, previousId, random)` → weighted pick, never `previousId`.
- [x] T007 [P] X client in `src/x/client.ts`: `getUserPosts(id)` (`GET /2/users/:id/tweets`, `exclude=replies,retweets`, `max_results=5`, `created_at`), `repost(accessToken, me, postId)` (`POST /2/users/:me/retweets`), `quotePost(accessToken, postId, text)` (`POST /2/tweets` with `quote_tweet_id`), `postStandalone(accessToken, text)`; Zod-parsed responses. Standalone posts only from `src/content/`.
- [x] T008 `src/content/slots.ts`: `reserveSlot(db, {kind, day, sourcePostId?, …}, cap)` inserts with the first free slot `1..cap` (`on conflict do nothing`, returns the row or null), `markPosted(id, postedId)`, `markFailed(id)` (status `failed`, `slot = null`); today's spend from cost rows vs `FEED_DAILY_USD_CAP`.
- [x] T009 Test `tests/integration/content.test.ts`: two parallel reservations of the same source → one row; cap 2 → third reservation null; a failed post frees its slot, its source stays used; a `reserved` row (crash) keeps its slot.
- [x] T010 [P] Test `src/content/pool.test.ts`: 10,000 seeded picks match each weight's share within 1.5 points; never the previous account; a disabled account is never picked.

**Checkpoint**: tables, X calls, weighted pick and reservations exist; nothing is scheduled. ✅

**Phase 2 done** (T004–T010). `feed_posts` carries a generated `cap_group`, so reposts and quote posts
share one daily cap in the database itself; a partial unique index on the source post stops a second
posting of it; checks hold that a refused post frees its slot while keeping its source, that a repost
stores no post id of ours, and that each kind carries what it needs. Dry-run picks are recorded as
`dry_run` rows (migration 0011): no slot of the cap, but the rehearsal still never repeats an account or
a post, with `previousAccountId` reading the last pool row. Deliberate deviations: no down migration
(this repo has none — migrations are append-only, so 0011 amends 0010 instead of editing it); cost
operations are `feed_read`, `feed_post`, `feed_model` rather than `read`/`post`/`repost`, so the daily
spend sums exactly the feed's own rows; X list prices live in `src/x/prices.ts`, since `src/llm/prices.ts`
is the model price list; the pool's ids sit in a generated `src/content/pool-ids.ts` written by
`content:pool-ids`, so T003 needs no hand-editing. Verified: 80 unit and 98 integration tests pass, both
migrations applied locally. **Supabase: not applied yet.** The X calls are unexercised — they cost money.

- [x] T010a Review fixes (code review, 2026-10-05): an empty `FEED_PLATFORM_ACCOUNT_ID=`/`FEED_DAILY_USD_CAP=` line now means "unset" instead of killing every entrypoint or setting the cap to 0 (default 0.15/day ≈ $4.5 a month, SC-002); `markPosted`/`markFailed` only move a `reserved` row, so an error after a successful post can no longer free a used slot; a unique index on `queue_item_id` (migration 0012) keeps an original from being posted twice after a crash; a timeline page survives a post with no `created_at` and an account that answers 200 with `errors`; `content:pool-ids` keys ids by the username X returns, skips handles it already has (paid call) and counts only resolved lookups; a pool handle with no id is logged, not silently dropped; the disabled-account test now exercises the real filter.

---

## Phase 3: User Story 1 — Pool reposts (P1) 🎯 MVP

**Goal**: twice a day, a weighted account's latest eligible post is reposted (9 in 10) or quoted with a verified quote or an AI joke (1 in 10).

**Independent test**: with `FEED_DRY_RUN=true`, `npm run content:tick -- pool` logs a pick (account, post id, mode) and records the read cost; nothing is posted.

- [x] T011 [US1] `src/content/eligible.ts`: `latestEligible(posts, now, usedIds)` → newest post ≤ 48 h old not already in `feed_posts`; pure.
- [x] T012 [P] [US1] Instructions `src/llm/instructions/feed.v1.md` + call in `src/content/quote.ts`: input the post text and the mode (`quote` → return one topic from the quote command's list; `joke` → one short line about the post, ≤ 200 chars, no @, #, links, no prediction, no new facts); Zod output; one flash-lite call, cost recorded.
- [x] T013 [US1] `src/bot/wikiquote.ts`: `wikiquoteQuote` takes an optional topic (tried first, then the random ones); export the topic list for T012.
- [x] T014 [US1] `src/content/quote.ts`: `quoteText(post, mode)` → the verified quote (`"text" — by`) or the joke, checked in code (`weightedLength` ≤ 200, `hasTagsOrLinks` false); any failure → null (plain repost).
- [x] T015 [P] [US1] Test `src/content/quote.test.ts`: a joke with @, #, a link, or over 200 chars → null; a quote with a link in it → null; a clean joke passes.
- [x] T016 [US1] `src/content/pool-run.ts`: `runPoolPost(deps, now)` → spend cap check (`feedSpentTodayUsd`) → pick (`previousAccountId`) → read posts (cost) → `latestEligible`, else pick again (≤ 3 tries) → roll 90/5/5 → dry run: `logDryRun` and stop / live: `reserveSlot` → repost or quote post → `markPosted` or `markFailed`, cost recorded. An account X reports as gone (4xx on its timeline) is skipped with one alert a day. Logs ids only, never post text.
- [x] T017 [US1] Schedule in `src/jobs/scheduler.ts`: `pool` job twice a day (09:00 and 18:00 UTC cron, then a random 0–90 min delay in the job), only when `ENABLE_FEED`; `content:tick` CLI in `src/cli/content-tick.ts` + `package.json` script to run one job by hand.
- [ ] T018 [US1] Follow the 15 pool accounts from @vaticeno (by hand in the app; owner), checking each one is still the account it claims to be.
- [ ] T019 [US1] Dry run for a week on the droplet (`ENABLE_FEED=true`, `FEED_DRY_RUN=true`); owner reviews picks (SC-001); read the measured X costs (SC-002); then `FEED_DRY_RUN=false`.

- [x] T017a Review fixes (2026-10-05): only the call to X sits inside the try, so a failure while marking leaves the row `reserved` (slot taken, never retried) instead of freeing a slot whose post already went out; a post stamped up to 5 min ahead of our clock still counts as fresh, since the newest post of a busy account is the one we want.

**Checkpoint**: US1 code done ✅ — `npm run content:tick -- pool` runs one pass; the scheduler runs it at
09:23 and 18:23 UTC when `ENABLE_FEED=true`. Dry run records the pick and posts nothing. Built: eligible
post choice (48 h, never used, clock-skew tolerant), the 1-in-10 quote turn (`feed.v1` names a Wikiquote
topic or writes one ≤ 200-char line, checked in code for tags, links and length, falling back to a plain
repost), the run itself (spend cap → weighted pick → read → eligible → roll 90/5/5 → dry-run record or
reserve-post-mark), the X wiring with a one-off token refresh on 401, and the CLI. An account X refuses
with a 4xx is skipped with an alert per occurrence (not deduped: at most a handful a day). 86 unit and 104
integration tests pass. Left in this phase: T018 and T019, both the owner's.

---

## Phase 4: User Story 2 — Owner-written originals (P2)

**Goal**: one owner-written post a day from a queue; no AI.

**Independent test**: queue 3 items, run `content:tick -- original` three times (dry run off on a test account or in the integration DB): each posted once, in order, then an alert.

- [ ] T020 [US2] `src/cli/content-queue.ts` + script: `add "<text>"` (checked: ≤ 280 as X counts, `hasTagsOrLinks` false), `list`, `remove <id>`.
- [ ] T021 [US2] `src/content/original-run.ts`: next unposted item by position → reserve (`original`, cap 1) → post standalone → mark item and row; empty queue → alert once a day (Sentry message).
- [ ] T022 [US2] Schedule `original` daily at a random time (cron 12:00 UTC + random 0–180 min delay) in `src/jobs/scheduler.ts`; add to `content:tick`.
- [ ] T023 [US2] Load the starter posts 2–10 from `docs/content-rules.md` into the queue (owner reviews the list first).

---

## Phase 5: User Story 3 — Receipts (P3)

**Goal**: a final verdict whose reply went out is quote-posted on the feed as a RECEIPT, at most 2 a day.

**Independent test**: a claim with `verdict_reply_tweet_id` set and no receipt row → one RECEIPT quote post; a STOPped author → none.

- [ ] T024 [US3] `src/content/receipt-run.ts`: claims with a posted verdict reply in the last 7 days, author not in `opt_outs`, no `feed_posts` row for that reply id → reserve (`receipt`, cap 2, source = verdict reply id) → quote post `RECEIPT · {HIT|MISS|VOID} · #slug` → mark.
- [ ] T025 [US3] Schedule `receipts` hourly in `src/jobs/scheduler.ts`; add to `content:tick`.

---

## Phase 6: Polish

- [ ] T026 [P] Docs: `docs/content-rules.md` "What runs automatically now" table, `README.md` (status, commands, env), `CLAUDE.md` active feature → 002.
- [ ] T027 Full test run (`npm test`, integration) and a deploy with `ENABLE_FEED=false`, then the switch-on steps of T019.

---

## Dependencies & Execution Order

- T001 blocks every task that posts (T016 live mode, T021, T024); dry run (T019) may start before it.
- Phase 2 (T004–T010) blocks all stories. T004 → T005 → T008 → T009.
- US1, US2, US3 are independent after Phase 2; US1 first (MVP).
- Owner tasks: T003 (paid lookup, ~$0.16), T018, T019 review, T023 review.

## Parallel Examples

- Phase 2: T006, T007 and T010 together (different files).
- US1: T012 and T015 while T011/T013 are done.

## Implementation Strategy

1. T001–T010, then US1 in dry run (T011–T019): the feed's value and cost are measured before anything posts.
2. Switch US1 live, then US2 (owner text needs no AI), then US3 when verdicts exist.
