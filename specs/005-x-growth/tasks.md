# Tasks: An account with its own voice and measurable site traffic

**Input**: [spec.md](spec.md), [plan.md](plan.md), `docs/decisions/008-x-growth.md`

**Tests**: only where a bug would post the wrong thing, post twice or post late: the queue's pick order (dated,
missed, held), the quiet-week alert, the claim guard, and the analytics hook. Nothing else gets a test.

**IDs**: T501–T599 (CLAUDE.md). Commits: `feat(005-T5NN): …`, one line. Editorial tasks marked **[owner]** are
done by the owner in the X app; their drafts live in `specs/005-x-growth/content/`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Decisions and site traffic

- [x] T501 Constitution VI 2.8.0 → 2.9.0 in `.specify/memory/constitution.md`: a claim is shown in an own-feed post
  only when its author is on the owner's list (the owner alone for now), all of the author's calls in a period
  and not only hits; the money rule set aside for now; `CLAUDE.md` version line. ADR `docs/decisions/008-x-growth.md`.
- [x] T502 [US1] `CF_ANALYTICS_TOKEN` (32 hex, optional) in `src/config.ts` and `.env.example`; `buildServer` in
  `src/web/server.ts` adds the beacon before `</head>` and the privacy line before `</main>` of every HTML
  response when set; `.privacy` style in `src/web/html.ts`; test in `tests/integration/pages.test.ts`; README.
- [x] T503 [US1] Go live: the vaticeno site token (from Cloudflare) as `CF_ANALYTICS_TOKEN` in the server's
  `.env`, deploy, check the dashboard. **On the owner's command.**

**Checkpoint**: traffic counted; the constitution allows the owner's calls.

---

## Phase 2: Profile and network (US2, US5) — editorial

- [x] T504 [P] [US2] Draft `content/profile.md`: bio (what it does, "Automated" label and operator kept,
  vaticeno.n30sk.cc as the only link), pinned post (one full example: prediction → RECORDED → HIT/MISS/VOID, how to
  tag the bot), header note. No promise of accuracy, no wager promotion.
- [x] T505 [US2] **[owner]** Apply bio, pinned post and header in the X app.
- [x] T506 [P] [US5] Research `content/accounts.md`: 35–40 candidates — sports 15, crypto and markets 10, politics
  7, forecasting 8 — ranked within category: name, exact handle, profile URL, audience where visible, why useful.
  From web research only; no paid X lookup. Marked unconfirmed until T507.
- [ ] T507 [US5] **[owner]** Open each profile URL: confirm the handle, a post in the last 14 days, nothing off-brand
  (betting brands out, as `@ESPNStatsInfo` was). Strike what fails.
- [ ] T508 [US5] **[owner]** Create three X Lists (Sports, Crypto & Markets, Politics & Public Affairs; forecasting
  accounts in the closest one) and follow 5–10 confirmed accounts a week, by hand. Never mass-follow, follow back
  or follow-unfollow.

---

## Phase 3: The queue on a calendar (US3)

- [x] T509 [US3] Migration `drizzle/0027_feed_calendar.sql` + `src/db/schema.ts`: `feed_queue.post_on date`,
  `source_url text` (CHECK https), `checked_on date`, `missed_at timestamptz`; CHECK `source_url` needs `post_on`
  and `checked_on`. `feed_posts.cap_group`: `digest` and `record` join `original` (one original a day, whichever kind). Down
  migration as the repo does. Apply locally; prod with the allow-listed command when the code ships.
- [x] T510 [US3] `FEED_SHOW_AUTHOR_IDS` (comma-separated numeric X ids; the owner's alone) in `src/config.ts`,
  `.env.example`.
- [x] T511 [US3] `src/content/claim-guard.ts`: a post naming a claim (`#slug`) passes only if the claim's author is
  on `FEED_SHOW_AUTHOR_IDS`. One query, no other rule. Used by T512 and T513.
- [x] T512 [US3] `src/content/original-run.ts`: retire every past-dated unposted item (`missed_at`, one
  `feed.dated_missed` each); stop if the day's original slot is taken; post today's dated item, else the first
  undated publishable one; hold a stale radar item (`feed.radar_stale`) or a failed claim guard
  (`feed.claim_held`); Friday `feed.quiet_week` when fewer than three own posts went out in the past 7 days;
  `feed.queue_empty` becomes a log line.
- [x] T513 [US3] `src/cli/content-queue.ts`: `add "…" [--on YYYY-MM-DD] [--source https://… --checked YYYY-MM-DD]`;
  refuse at once: a past date, a Monday or Friday date (the record's days), a source without a date or check
  date, a claim failing the guard. `list` shows date, source host, check date, held or missed.
- [x] T513a [US3] Tests in `tests/integration/content.test.ts`: dated today beats undated; a past-dated item is
  retired and alerted once even after two days down; the digest's slot stops the original that day; stale radar
  held; a Friday after two own posts alerts, after three does not; the guard holds a claim
  whose author is not on the list, at `add` and at post time.
- [x] T514 [US3] Curated reposts: `src/llm/instructions/repost.v1.md` (the policy's kinds and exclusions) and a
  lite-model classifier in `src/content/pool-run.ts`: each candidate → kind and fit; repost the best above `none`,
  else one other account, else skip and log. Cadence unchanged (two a day). Costs logged. Test: a `none` for every
  candidate posts nothing; a fit beats a newer `none`.

**Checkpoint**: a week of dated posts goes out on its days; the queue warns before it runs dry.

---

## Phase 4: The week's record (US4)

- [x] T515 [US4] Build spec 002 T050–T055 as written there (deadline digest Monday morning, record counts Friday
  afternoon), with no migration of their own (their kinds and `payload` are in 0027); both take the day's original slot (T509);
  002 FR-012a's money filter is not built (constitution VI: set aside for now). Mark them done in `specs/002-content-feed/tasks.md`.

---

## Phase 5: Event posts by the bot (US3a)

- [x] T516a [US3a] Topics in `src/content/topics.ts`: 10 sports (football, American football, basketball, tennis,
  F1, horse racing, cricket, baseball, combat sports, golf) and 8 others (crypto, central banks, economic data,
  earnings, politics, tech, space, awards), each with its season and official sources; all weighted alike (owner,
  2026-11-06). `drawTopic` and `npm run content:topic [-- --last <id>]`: random, in season, never the last.
- [x] T516 [US3a] `src/llm/instructions/event.v1.md` + `src/content/event-find.ts`: one grounded model call per
  topic — the nearest major scheduled event 3–10 days ahead: name, date (UTC day), place, 2–4 page URLs. Zod schema;
  a malformed answer is no event.
- [x] T517 [US3a] `src/content/event-check.ts`: read each URL with the existing page reader; accept only when two
  pages on different sites both contain the event's name and its date (any common date form). Pure check over
  page text, which is never stored.
- [x] T517a [US3a] `src/content/event-post.ts`: the template (event · scheduled for · date · place, plus one of a
  few fixed closing lines), the usual own-feed text checks, and `src/content/event-run.ts`: free slot → up to three
  topics → post once, kind `event` with payload {topic, name, date} (migration in T509); the next run's last topic is the latest event post's, never the same event twice,
  costs logged, dry run respected. Scheduled Tue–Thu after the queue run.
- [ ] T517c [US3a] Event poster (FR-024): `src/content/event-image.ts` — one Gemini 2.5 Flash Image call from a fixed
  prompt per sport (abstract, no text, no logos, no "Vaticeno"), cost logged; X media upload in `src/x/client.ts`;
  `media.write` added to `OAUTH_SCOPES` and the owner logs the bot in once more (`poc:auth`, as the vaticeno
  user). A failed image or upload posts the text alone.
- [x] T517b [US3a] Tests: two agreeing pages post; one page, or disagreeing dates, do not; three failed topics post
  nothing; a repeat event is skipped; the text never carries a link, a handle or a hashtag.
- [ ] T518 [US3] **[owner]** Record at least two predictions a week through the bot; after each lock or verdict,
  write its post ("CALL · recorded on Vaticeno"), misses included, and queue it.

---

## Phase 6: Measure and keep it running (US6)

- [x] T519 [US6] `src/cli/growth-week.ts` + `npm run growth:week [--quotes N]`: last 7 days from the database only —
  claims recorded; active authors and first-time authors, the owner left out; automated posts by kind; the
  four-week share of own posts only when `--quotes N` gives the owner's hand-made quote posts, else the subtotal.
  Prints where to read X's and Cloudflare's numbers. Free.
- [x] T520a Update spec 002 to match: FR-002 and FR-003 (two a day, curated by the repost policy), FR-005 (the queue's
  dates, the shared daily cap, the held post, the Friday quiet-week alert), FR-011 (digest Monday, record Friday,
  in the original slot), FR-012a (set aside for now, constitution VI 2.9.0); point each to spec 005.
- [x] T520 [P] Rewrite `docs/content-rules.md`: the two channels, the formats, no links in the bot's posts (and why:
  $0.20 vs $0.015), the owner's calls, the weekly routine (review the next 7 days, re-check events — a sports fixture
  again on its day —, add posts, run `growth:week --quotes N`, read both dashboards). Update `README.md` (status table, commands) and `docs/progress.md`.
- [ ] T521 **[owner]** Weekly, every Friday: the routine above. Four reviews by the end of week 4 (SC-004).

---

## Dependencies

- T501 blocks T511's claim guard and T518. T502 → T503.
- T509 → T510 → T511 → T512 → T513 → T513a; T514 any time. T515 after T509 (migration order). T520a with the code it describes.
- T504 → T505; T506 → T507 → T508. T516 → T517 → T517a → T517b, after T509 (the `event` kind) and T512 (the
  shared slot).
- T519 any time after T509.

## Order of work

1. T503 when the owner says deploy (one line, already built).
2. Editorial first, in parallel: T504, T506, T516 drafts — they need no code and are the account's voice.
3. Code: Phase 3, then T515 and T519, one branch, one pull request.
4. From then on, the owner's weekly routine (T518, T521).
