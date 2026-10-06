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
- [x] T017 [US1] Schedule in `src/jobs/scheduler.ts`: `pool` job twice a day, only when `ENABLE_FEED`. **Narrowed**: fixed off-the-hour times (09:23 and 18:23 UTC) instead of a random in-job delay — a delay of up to 90 minutes would hold the job and block a clean shutdown, and an odd minute is enough not to look like a clock; `content:tick` CLI in `src/cli/content-tick.ts` + `package.json` script to run one job by hand.
- [x] T018 [US1] Follow the 15 pool accounts from @vaticeno (owner, 2026-10-05): the list is accepted as it stands; `@ESPNStatsInfo` (hijacked handle) and `@_1woonomic` (dormant) were dropped in the process.
- [x] T019 [US1] **Narrowed (owner decision 2026-10-05): no rehearsal week.** Go straight live on the droplet — `ENABLE_FEED=true`, `FEED_DRY_RUN=false` in `/opt/vaticeno/.env`, then `deploy/deploy.sh`. The caps (2 pool posts a day) and the owner's ability to delete a post by hand replace the dry run; SC-001 becomes a running check of the logged picks instead of a gate, and SC-002's prices are read off the first `cost_events` rows.

- [x] T017a Review fixes (2026-10-05): only the call to X sits inside the try, so a failure while marking leaves the row `reserved` (slot taken, never retried) instead of freeing a slot whose post already went out; a post stamped up to 5 min ahead of our clock still counts as fresh, since the newest post of a busy account is the one we want.

**Checkpoint**: US1 code done ✅ — `npm run content:tick -- pool` runs one pass; the scheduler runs it at
09:23 and 18:23 UTC when `ENABLE_FEED=true`. Dry run records the pick and posts nothing. Built: eligible
post choice (48 h, never used, clock-skew tolerant), the 1-in-10 quote turn (`feed.v1` names a Wikiquote
topic or writes one ≤ 200-char line, checked in code for tags, links and length, falling back to a plain
repost), the run itself (spend cap → weighted pick → read → eligible → roll 90/5/5 → dry-run record or
reserve-post-mark), the X wiring with a one-off token refresh on 401, and the CLI. An account X refuses
with a 4xx is skipped with an alert per occurrence (not deduped: at most a handful a day). 86 unit and 104
integration tests pass. Phase 3 closed: T018 and T019 settled by the owner (no rehearsal; the feed goes live with the next deploy).

---

## Phase 4: User Story 2 — Owner-written originals (P2)

**Goal**: one owner-written post a day from a queue; no AI.

**Independent test**: queue 3 items, run `content:tick -- original` three times (dry run off on a test account or in the integration DB): each posted once, in order, then an alert.

- [x] T020 [US2] `src/cli/content-queue.ts` + script: `add "<text>"` (checked: ≤ 280 as X counts, `hasTagsOrLinks` false), `list`, `remove <id>`.
- [x] T021 [US2] `src/content/original-run.ts`: next unposted item by position → reserve (`original`, cap 1) → post standalone → mark item and row; empty queue → alert once a day (Sentry message).
- [x] T022 [US2] Schedule `original` daily in `src/jobs/scheduler.ts`; add to `content:tick`. **Narrowed** the same way: a fixed 13:41 UTC, no in-job delay.
- [x] T023 [US2] Starter posts 2–10 written out as final text in `src/content/starter-posts.ts` and loaded with `npm run content:queue -- load-starters` (idempotent: an item already in the queue is skipped). Loaded locally; the owner runs the same command against the server database when ready.

- [x] T023a Review fix (2026-10-05): the queue skips an item that already has a `feed_posts` row, so a lost `posted_at` mark (a crash right after the post went out) can neither republish that post nor jam the queue for good — found by the test, which now proves both.

**Checkpoint**: US2 done ✅ — `npm run content:queue -- add "…" | load-starters | list | remove <id>`
manages the queue (each item checked against X's limit and refused if it carries a tag, link or hashtag);
the `original` job posts the next item at 13:41 UTC when `ENABLE_FEED=true`, one a day, in order, marks
the item, and alerts when the queue runs dry. `npm run content:tick -- original` runs it by hand. The
daily cap, "never twice" and the crash cases are covered by integration tests (107 pass, 86 unit).

---

## Phase 5: User Story 3 — Receipts (P3)

**Goal**: a final verdict whose reply went out is quote-posted on the feed as a RECEIPT, at most 2 a day.

**Independent test**: a claim with `verdict_reply_tweet_id` set and no receipt row → one RECEIPT quote post; a STOPped author → none.

- [x] T024 [US3] `src/content/receipt-run.ts`: claims with a posted verdict reply in the last 7 days, author not in `opt_outs`, no `feed_posts` row for that reply id → reserve (`receipt`, cap 2, source = verdict reply id) → quote post `RECEIPT · {HIT|MISS|VOID} · #slug` → mark.
- [x] T025 [US3] Schedule `receipts` hourly in `src/jobs/scheduler.ts`; add to `content:tick`.

- [x] T025a Review fix (2026-10-05): the receipts query now skips verdicts that already have a `feed_posts` row and takes the newest first — without it, two old verdicts were re-picked every run and a fresh verdict would never have got its receipt (found by the test).

**Checkpoint**: US3 done ✅ — the `receipts` job runs hourly (`ENABLE_FEED=true`) and quote-posts the
bot's own verdict reply as `RECEIPT · HIT|MISS|VOID · #slug`, at most 2 a day, once per verdict, never
for an author who sent STOP, and only for verdicts from the last 7 days. `npm run content:tick -- receipts`
runs it by hand. 86 unit and 109 integration tests pass.

---

## Phase 6: Polish

- [x] T026 [P] Docs: `docs/content-rules.md` "What runs automatically now" table, `README.md` (status, commands, env), `CLAUDE.md` active feature → 002.
- [x] T027 Full verification: typecheck clean, 86 unit and 109 integration tests pass, 83.5% line coverage. **The deploy is the owner's step** (production): `ENABLE_FEED=true`, `FEED_DRY_RUN=false` in `/opt/vaticeno/.env`, then `deploy/deploy.sh root@HOST`; `npm run content:queue -- load-starters` against the server database fills the queue.

---

**Phase 6 done**: `docs/content-rules.md` shows what the feed does automatically and what stays by hand,
`README.md` carries the feed's status and its three commands, `CLAUDE.md` points at spec 002. Everything
in this spec is implemented and verified; what is left is the owner's deploy and the queue load.

- [x] T028 Review fixes (code review medium, 2026-10-05): the receipt line no longer carries `#slug` — X rendered it as a hashtag, which own-feed text must not have (constitution VI 2.4.0); the originals and receipts jobs now record their post as a cost row and honour `FEED_DAILY_USD_CAP`, which only the pool job did, so a third of the feed's spend was invisible to its own cap; a dry run of the daily own post no longer reserves anything, since any row at all retired the queue item for good (with `FEED_DRY_RUN=true` as the default, nine dry runs would have silently wiped the nine starter posts); the reserve/post/mark money guard moved into `src/content/spend.ts` (third use), which is what the two later jobs were missing.
- [x] T029 Thread context and inference (owner report, 2026-10-05): `normalize.v4` never asks for what it can work out — a follower, like or view count with no platform named is an X count; "in a month"/"next month"/"next week"/"by the weekend" are computed from TODAY; a bare name the thread above already names is that subject. The recorder now passes the posts above the mention as `context` (already-paid reads, nothing stored), and the summon's own words when it records the parent post.

- [x] T030 Hand-run beats the caps (owner decision 2026-10-05): `content:tick` posts even when the day's slots are used — the daily caps pace the scheduler, not the owner — and it skips the spend cap too; `--respect-caps` keeps the old behaviour. "Never the same post twice" still holds either way, because that one is X's rule. The `ENABLE_FEED` check is gone from the CLI as well: typing the command is the intent.

- [x] T031 Quote replies cleaned up (owner report 2026-10-05, a real reply read back from X): the attribution is the author's name alone — the old code cut the whole Wikiquote citation at 90 characters and left "…A Little Bit of Mambo (19 July 1999), New York: R" in a live post; entries whose source names a song, album, film or episode are skipped, since lyrics and dialogue read as nonsense under a prediction ("Flirting is just like a sport. Yes Sir."); and `Sports` is out of the quote topics for the same reason, in `quote` and in the feed's `feed.v1` list.

- [x] T032 Two live failures fixed (owner reports 2026-10-05, both read back from X): a Wikiquote source line whose citation template opened on that line but closed on the next left `{{cite news` in a posted reply — an unterminated template is now cut, the author's name alone is kept, and any entry still carrying wikitext (doubled braces or brackets, a pipe, a `<ref`) is skipped rather than posted, with the same guard again on the finished reply; single `[brackets]` stay, since a quotation may carry an editorial insertion. Separately, `normalize.v5`: an event on a known schedule IS a deadline — "the next US presidential election" is recorded as 2028-11-07, not sent back as a question — and the rule is written into `CLAUDE.md` and the 001 spec: if a date can go into the suggested example, it must be recorded.

- [x] T033 Hand-picked post kind, and a closed claim records anew (owner decisions 2026-10-05): `content:tick -- pool --mode repost|quote|joke` forces one kind instead of the roll; a reply under a claim that can no longer change (locked, closed, expired, out of fixes) is recorded as a NEW claim instead of being answered "can no longer be changed" — only a mid-flight conflict still gets the refusal.
- [x] T034 X blocks quoting third parties (OBSERVED 2026-10-05): a quote post of a pool account's post is refused with 403 "You can only reply to or quote posts where you are mentioned or are the author". Pool runs are plain reposts for now (`REPOST_SHARE = 1`, tagged `HACK(x)` with a REVISIT); receipts still work because we quote our own verdict replies. FR-004 marked blocked in the spec.

- [x] T035 Dates in posted text read as "16 Oct 2026" (owner decision 2026-10-05): one rewrite on the way out of every reply — recordings, fixes, verdicts — so nobody has to guess whether the middle number is the month; ISO stays in the database, the contract and the claim pages, and the rewrite is skipped if it would push a reply past X's limit.

- [x] T036 The thread is read only when it is needed (owner question 2026-10-06): recording a prediction makes no extra reads; if the first answer is "unclear" and the author was replying to someone, the posts above are read then and the claim is judged again with them. A fix starts from the claim's own criterion, which is free, and reads the thread only if that still leaves it unclear. Before this, every mention in a thread paid for up to 3 post reads whether it needed them or not (~$0.015 each).

---

## Phase 7: The `quote` command picks its topic from context (owner decision 2026-10-06)

**Why**: `quote` searches 3 of 9 Wikiquote topic pages at random today, so a request under a crypto
thread can come back with a gambling aphorism. A quote always goes out either way — the question is only
which page is searched first. Reading X is the only part that costs money, so each step below runs only
when the previous one came up empty.

| Step | When it runs | Share (estimate) | Cost when it runs | Average per quote |
|---|---|---:|---:|---:|
| 1. Keyword match on the request, in code | always | 100% | $0 | $0 |
| 2. `quote-topic.v1` on the request text alone | no keyword matched | 100% | $0.0002 | $0.0002 |
| 3. + the parent post, asked again | step 2 answered `null`, or it is a bare "quote" | 10% | $0.0052 | $0.0005 |
| 4. + 2 more posts above, asked again | the parent did not settle it either | 5% | $0.0102 | $0.0005 |
| 5. Random topic, as today | no topic was found | rest | $0 | $0 |

**Total ≈ $0.0012 per quote**: $0.19 a month at 5 a day, $0.74 at 20 a day, $1.85 at 50 a day. Even if
the shares turn out five times worse (50% / 25%), it stays under $1 a month at today's traffic. Prices:
flash-lite topic call ≈ $0.0002, one X post read $0.005 (UNRECONCILED, `src/x/prices.ts`).

- [x] T037 `src/bot/quote-topic.ts`: `topicFromWords(text)` — a keyword map over the 9 topics (btc, bitcoin, sats → Bitcoin; odds, wager, bookie → Betting; forecast, model, poll → Forecasting; …), matched on whole words, case-insensitive, no model call. Unit-tested; returns null when nothing matches.
- [x] T038 `src/bot/quote-topic.ts`: `topicFromModel(deps, text, context)` — one flash-lite call on `quote-topic.v1` (instruction file written), Zod `{ topic: enum | null }`, cost recorded as `normalize` on the extras path; any failure returns null, never an exception into the reply path.
- [x] T039 `src/bot/extras.ts`: the cascade in `quoteReply` — keywords → model on the request → (only if still null and the mention is a reply) read the parent and ask again → (only if still null) read 2 more posts above and ask again → random. The chosen topic goes to `wikiquoteQuote(pick, 3, topic)`, which already tries it first. Every quote logs which step decided it (`event: 'quote.topic'`, `step`, `topic`), so the estimated shares above can be replaced by measured ones.
- [ ] T040 Two weeks after T039 ships: read the `quote.topic` logs, write the real shares into this phase, and drop step 4 if it never changes the topic the parent already gave.

- [x] T039a Review fix (2026-10-06): the reader hands back where the walk stopped, so step 4 reads only the two posts above the parent instead of re-reading the parent it already paid for (step 4 is 2 reads, as the table says, not 3).

**Checkpoint**: done ✅ — a `quote` under a Bitcoin thread answers with a Bitcoin quote; a bare `quote`
with no thread still answers, from a random topic, with no paid read. The chosen topic is kept with a
deferred quote, so a retry re-reads Wikiquote only — never X or the model. Each quote logs
`event: 'quote.topic'` with the step that decided it (`words`, `model`, `parent`, `thread`, `random`),
and the reply's action carries the same step. 94 unit and 113 integration tests pass.

---

- [x] T041 Receipts read like the replies (owner decision 2026-10-06): the claim's slug is back as `#slug` — an id, not a topic, so constitution VI is amended to 2.4.1 to allow that one hashtag — and the receipt now carries the result the judge read (a match's score, a close price) when the deciding evidence has one. The judge's words go through the same check as any posted text: a result that smuggles in a handle, a link or another hashtag is dropped whole and the receipt still goes out.

- [x] T042 A claim never locks against a contract its author was never shown (live defect 2026-10-06): new tokens were generated for the account, which revoked the ones the service held, so a recorded prediction's reply died on a 401 — and the claim locked itself 15 minutes later anyway, immutable, with the author never told. Now a reply that fails to post withholds the lock (the 15 minutes cannot start before the author can read the contract), the lock job passes such a draft by, and a sweep on the same 24 h clock as needs info closes it instead of leaving an open claim nobody was told about. Covered by an integration test that fails a reply, proves the claim stays an unlocked draft an hour later, and watches it expire a day later.

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
