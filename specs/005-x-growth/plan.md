# Implementation Plan: An account with its own voice and measurable site traffic

**Spec**: [spec.md](spec.md) · **Decision**: `docs/decisions/008-x-growth.md` · **Tasks**: [tasks.md](tasks.md)

## Summary

Most of this feature is editorial work done by hand: a profile, a network of accounts, a calendar of posts. The
code is small and sits on what spec 002 built: the queue gets dates, a source link and a last-checked date; the
own-post job picks today's dated post first, never posts a missed one late, holds a stale event post, and alerts
once at a low-water mark instead of every day; the pool posts on two days a week; spec 002 US4 (deadline digest,
record counts) is finally built, for Monday and Friday; a free weekly review command counts what the database
knows. Site traffic is Cloudflare's script on the public pages, already written.

## Technical Context

Node 22, TypeScript, Fastify, Drizzle on Postgres; `src/content/` (spec 002) and `src/cli/content-queue.ts`. No
new dependency: Cloudflare's beacon is a script tag served by Cloudflare, not a package. One migration.

## Constitution Check

| Principle | How this passes |
|---|---|
| IV Speak only when spoken to | the bot adds no reply, no follow, no mention; follows, Lists, quote posts and replies are the owner's, by hand |
| V IDs, not text | the queue is the owner's own text, already allowed (spec 002); its new source link is a link, not content; nothing from X is stored |
| VI Platform policy | 2.9.0: a claim's terms and verdict are shown only for an author on the owner's list (the owner alone for now); the digest's slug-and-date line is not such a post; the money rule set aside for now; no @mention, no link, no hashtag but the slug in feed text; caps unchanged |
| VII Boring | one migration, one config list, one CLI; no new package; the beacon is the pages' second script, loaded async, off unless configured |

## Site traffic (done, not deployed)

`CF_ANALYTICS_TOKEN` (32 hex, optional) in `src/config.ts`. Set, `buildServer` adds one `onSend` hook: every
`text/html` response gets the beacon before `</head>` and the privacy line before `</main>`. One hook rather
than a parameter on every page renderer: the pages stay pure, and no global. The status page is another
service and never sees it. Go-live: the token into the server's `.env`, then a deploy.

## The queue (US3)

Migration `drizzle/0028_feed_calendar.sql` (0027 is reserved by 003 for wallet links) adds to `feed_queue`:

| Column | Meaning |
|---|---|
| `post_on date` | the day it goes out; null = any free day, in position order |
| `source_url text` | an Event Radar's source, https only (CHECK); for the owner's fact-check, never posted |
| `checked_on date` | when the owner last confirmed the event; required with `source_url` (CHECK) |
| `missed_at timestamptz` | set when a dated item's day passed unposted and the owner was alerted; retires it |

Daily run (`src/content/original-run.ts`), in order:

1. Every dated item whose day has passed, unposted and with `missed_at` null: set `missed_at`, alert
   `feed.dated_missed` once each. Recoverable after downtime: the marker, not "yesterday", decides.
2. If the day's original slot is already taken (the Monday digest or Friday record went out, below), stop.
3. A dated item for today → post it, unless held: a `source_url` with `checked_on` more than 7 days before
   `post_on` (`feed.radar_stale`), or a named claim that fails the guard (below, `feed.claim_held`).
4. Otherwise the first undated, publishable item by position, as today.

**One daily cap for every original.** The digest and record posts take the same day slot as a queued original:
in the generated `cap_group`, `digest` and `record` join `original`, so the existing unique index allows one of
them a day. A digest with nothing to say posts nothing and leaves the slot free. `content:queue -- add --on`
refuses a Monday or Friday date while US4 runs, so a dated post is never crowded out. The week is then 3 queued
originals plus the 2 record posts: the 4–5 originals of FR-009.

Low-water alert without state: every Friday run, if fewer than four **publishable** items remain (undated, or
dated today or later, not missed, not held by the radar or claim guard), alert `feed.queue_low` once with the
count; the run that posts the last one alerts too. Never one a day. `feed.queue_empty` becomes a log line.

## The claim guard: a list

A post naming a claim (`#slug`) goes out only if its author is on `FEED_SHOW_AUTHOR_IDS` (configuration; the
owner's X user id alone for now), checked when it is queued and again when it is posted. Off the list: held, not
posted, alerted once (`feed.claim_held`), and counted as unpublishable. Removing an id holds that author's queued
posts; nothing already out is deleted. Nothing checks for money (constitution VI: set aside for now).

`content:queue -- add "…" [--on YYYY-MM-DD] [--source https://… --checked YYYY-MM-DD]` checks everything it can
at once: length, no tags or links in the text (as today), a past date or a Monday/Friday date, a source without a
date and a check date, a named claim whose author is not on the list. `list` shows dates and check dates.

## The owner's calls (FR-014, FR-014a)

`FEED_SHOW_AUTHOR_IDS` in config, the owner's id alone. That is the whole permission mechanism for now; how others give permission is
decided later. The owner records predictions through the bot like anyone; the post about one is written by the
owner after the lock or the verdict and queued like any other.

## Pool cadence (FR-011)

`FEED_POOL_DAYS` (default `2,6` — Tuesday and Saturday, cron day numbers): the pool job runs once on those days at
18:23 UTC instead of twice a day. About two reposts a week.

## The week's record (US4)

Spec 002 T050–T055 as written there, scheduled Monday (digest, morning) and Friday (record, afternoon). Their
migration becomes `0029_feed_digest.sql`; 002 named 0016 before 003 took the numbers. Tasks stay in 002's
tasks.md and are marked there; 005 tracks them by reference.

## Weekly review (US6)

`npm run growth:week [--quotes N]` — free, database only: claims recorded in the last 7 days; **active authors**
(distinct authors who tagged the bot this week) and **first-time authors** (none of their claims before this
week), the owner left out of both; automated posts sent by kind. The four-week share of own posts needs the
owner's hand-made quote posts, which the database never sees: given `--quotes N` (from X's dashboard) it prints
the share; without it, the automated subtotal and "share needs the quote count". X's and Cloudflare's dashboards
are read by the owner; the command prints where.

## Editorial work (by hand, drafted in this folder)

| File | What |
|---|---|
| `content/profile.md` | bio (Automated label and operator kept), pinned post, header note |
| `content/accounts.md` | 35–40 candidate accounts, ranked by category, three Lists; each with a profile URL the owner opens to confirm it (handle lookups stay free: no paid API call) |
| `content/week-01-02.md` | the first two weeks of originals, dated, sources and check dates for Event Radar items |
| `docs/content-rules.md` | rewritten: two channels, formats, the link rule, the owner's calls, the weekly routine |

## Cost

X's rate card (docs.x.com, checked 2026-11-06): post read $0.005 per resource, Post: Create $0.015, Create with
URL $0.20, content management $0.005. Per week:

| Post | Calls | Cost |
|---|---|---|
| 3 queued originals + digest + record | 5 × Post: Create | $0.075 |
| 2 pool reposts | each: one timeline read of up to 5 posts ($0.025) + the repost, recorded at $0.015 | $0.080 |
| **Total** | | **≈ $0.16/week**, against ~$0.60 now |

The repost is recorded at the Post: Create price today; X may bill it as content management ($0.005).
UNRECONCILED until checked against our usage. No AI call anywhere in this feature.

## Risks

- **The queue runs dry again.** The low-water alert and the weekly review only help if the owner acts; the
  review is the routine, not the alert.
- **A stale event post.** Held by the 7-day check, but a cancelled event checked yesterday still goes out; the
  weekly review is the guard.
- **Undercounted traffic.** Ad blockers and missing referrers; the numbers are a floor, and the review says so.
