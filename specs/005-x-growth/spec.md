# Feature Specification: An account with its own voice and measurable site traffic

**Feature Branch**: `005-x-growth`

**Created**: 2026-11-06

**Status**: Draft

**Input**: Owner, 2026-11-06: turn @vaticeno from an account that reposts sports news into one with its own
voice, original posts, relevant followers and people who start tagging it — "The world makes predictions.
Vaticeno keeps score." And: there are no statistics at all; at least count who opens the site, free and not
stored on our own server (Cloudflare Web Analytics, owner's choice). Decision record: `docs/decisions/008-x-growth.md`. Tone and series:
`docs/content-rules.md`.

The owner's brief predates Stage 4 going live and asks that real-money wagers not be presented as live. They
are live now (spec 003 Stage 4, no legal gate: owner 2026-10-29); this spec keeps the brief's intent — the
account does not promote wagering — and drops the outdated premise.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Count who opens the site (Priority: P1)

The owner asks how many visits and page views the site had this week, which pages were viewed and where the
visits came from, and gets numbers: per day, claim pages versus the front page versus wager pages, how many from X.
Aggregate traffic, not a count of people.

**Why this priority**: every other story here is judged by whether people arrive; today nothing is counted.

**Independent Test**: open three public pages from a browser, one through a t.co link; within the hour the
dashboard shows the three page views and nothing from the status page, and t.co as the referrer when the browser
sent one (an in-app browser may not; that visit counts as direct).

**Acceptance Scenarios**:

1. **Given** a public page (front, claim, wager, author), **When** anyone opens it, **Then** the visit is counted
   by Cloudflare's free analytics, with no cookie set and no consent banner shown.
2. **Given** a week of visits, **When** the owner opens the Cloudflare dashboard, **Then** it shows visits and
   page views per day, top pages, referrers (X via t.co, search, direct) and countries.
3. **Given** the status page, **When** the owner opens it, **Then** nothing is counted: the script is on public
   pages only.

---

### User Story 2 - A profile that says what Vaticeno is (Priority: P1)

A visitor opening the profile understands in five seconds that Vaticeno records predictions and checks them,
and sees a pinned post that shows how to use it.

**Why this priority**: every other post sends people to the profile; today it reads as a sports repost feed.

**Independent Test**: someone who has never heard of Vaticeno reads the profile and says what it does and how to
use it, without opening anything else.

**Acceptance Scenarios**:

1. **Given** the drafted bio, **When** the owner applies it, **Then** it states what Vaticeno does, keeps X's
   "Automated" label and names the operator (constitution VI), and links only to vaticeno.n30sk.cc.
2. **Given** the drafted pinned post, **When** the owner pins it, **Then** it shows one complete example ("BTC
   above $100k by 31 Dec" → RECORDED → HIT/MISS/VOID) and how to tag the bot.

---

### User Story 3 - Originals on a calendar (Priority: P1)

Four or five times a week the account posts something of its own: what makes a prediction checkable, an event
coming up whose outcome will be public, a principle, the week's numbers. The owner approves each post once, with
its date, and the bot posts it on that day.

**Why this priority**: it is the account's voice; the queue ran dry on 19 Oct and nothing of its own has gone out
since.

**Independent Test**: queue three posts dated Monday, Wednesday and Friday and one undated; over the week each
dated post goes out on its day, the undated one on the first free day, and nothing posts twice.

**Acceptance Scenarios**:

1. **Given** a queued post with a date, **When** that day's run comes, **Then** it is posted that day, ahead of
   undated posts.
2. **Given** a dated post the run could not post on its day (server down, X refused), **When** the next day
   comes, **Then** it is not posted late; the owner is alerted. A radar of last week's events is worse than none.
3. **Given** an undated post and no dated one for today, **When** the run comes, **Then** the oldest undated post
   goes out, as today.
4. **Given** a post over X's length limit, or carrying anything the constitution forbids in the bot's own text,
   **When** the owner queues it, **Then** it is refused at once, not on the day.
5. **Given** fewer than four approved posts on a Friday, **When** that day's run comes, **Then** the owner is
   alerted once with the count; the run that posts the last one alerts too. Never one a day while it stays low:
   the daily `feed.queue_empty` alert that became noise goes.
6. **Given** an Event Radar post, **When** the owner queues it, **Then** it must carry its date, its source link
   and when it was last checked; the link stays in the queue for the owner's fact-check and never in the post.
7. **Given** an Event Radar post last checked more than 7 days before its date, **When** its day comes, **Then**
   it is held, not posted, and the owner is alerted to check the event again.

---

### User Story 4 - The week's record, posted by the bot (Priority: P2)

On Monday the account names the recorded claims coming due this week; on Friday it posts the past week's
counts — recorded, came due, hit, missed, void. This is spec 002 User Story 4, specified and never built.

**Why this priority**: it is the only content no other account can post, and it costs no AI call.

**Independent Test**: as spec 002 User Story 4 states it.

**Acceptance Scenarios**: spec 002 User Story 4, scenarios 1–7, unchanged; Monday and Friday are the fixed days.

---

### User Story 5 - A network worth reading (Priority: P2)

The account follows 35–40 real accounts in sports, crypto and markets, politics, and forecasting, added 5–10 a
week, sorted into three X Lists, so its timeline is where the predictions it can record are made.

**Why this priority**: it is how the account finds conversations to join and events to post about; it is also
the source of future pool accounts.

**Independent Test**: every recommended account has an exact handle, a profile URL that opens, a post in the
last 14 days and a stated reason; none is invented.

**Acceptance Scenarios**:

1. **Given** the research list, **When** the owner reviews it, **Then** each entry names the account, its exact
   handle and URL, category, audience size where X shows it, its last post date and why it is useful, ranked
   within its category.
2. **Given** a week, **When** the owner follows, **Then** it is 5–10 accounts by hand, never mass-follow, follow
   back or follow-unfollow.

---

### User Story 6 - Know what works (Priority: P3)

Every Friday the owner sees one short review: followers and profile visits (from X's own dashboard), site visits
and visits from X (US1), people other than the owner who tagged the bot, claims recorded, and which posts did
best — and changes next week's mix from it.

**Why this priority**: it decides what to keep doing; it needs the other stories running first.

**Independent Test**: one week's review is produced from the three sources with no number guessed.

**Acceptance Scenarios**:

1. **Given** a week, **When** the review is made, **Then** active authors (who tagged the bot this week) and
   first-time authors (never before this week) are counted from the database, the owner excluded, free; the rest
   is read, not estimated.
2. **Given** the owner's hand-made quote posts, which the database never sees, **When** the share of own posts is
   reported, **Then** it includes the count the owner reads from X's dashboard, or is not reported at all.

### Edge Cases

- An event in a queued radar post is moved or cancelled before its day: the weekly review catches it and the
  owner removes or replaces the post (`content:queue -- remove`); the bot does not check event dates itself.
- A post's wording would read as a tip or a promise ("will", "lock in your win"): the owner's review catches it;
  the bot only enforces what code can (length, tags, links).
- A pool account changes hands or turns spammy: the owner removes it from the pool, as today.
- Cloudflare's script is blocked or down, or an ad blocker or privacy browser stops it: the page works as before;
  that visit is not counted. Traffic is undercounted, and the review says so.
- A browser or X's in-app browser sends no referrer: the visit counts as direct. Visits "from X" are a floor.
- The owner opens the site often: the owner's own visits are counted like anyone's. The status page is left out.

## Requirements *(mandatory)*

### Functional Requirements

**Site analytics (US1)**

- **FR-001**: Every public page (front, claim, wager, author) carries Cloudflare Web Analytics' one-line script,
  with the site's token from configuration; no token, no script. The site stays where it is: no DNS move, no
  proxy. What it measures is aggregate traffic — page views, visits, paths, referring hosts, countries, devices —
  never who a visitor is.
- **FR-002**: Nothing is stored on our server or in our database; the numbers live in the owner's Cloudflare
  account. The script sets no cookie and no local storage, so no consent banner is added for it.
- **FR-002a**: The site carries a short privacy note: aggregate, cookie-free traffic analytics by Cloudflare, used
  only to measure traffic, never joined to an X account, a wallet or a prediction.
- **FR-003**: The status page carries no script.
- **FR-004**: It is the second browser script on the public pages and the first from outside. Loaded async, so a
  blocked or slow script never delays or breaks a page. It cannot be pinned with subresource integrity
  (Cloudflare does not version it). If the site ever sends a content security policy, it allows Cloudflare's
  beacon host for scripts and connections. Query strings are not recorded, so no campaign tags.

**Profile and network (US2, US5 — by hand)**

- **FR-005**: Bio, pinned post, header, follows and X Lists are drafted for the owner and applied by the owner in
  the X app. The bot never follows, unfollows, lists or pins.
- **FR-006**: Every recommended account is checked on X before it is listed: exact handle, profile URL, a post in
  the last 14 days. None is taken from memory or an old search result.

**Originals and cadence (US3, US4)**

- **FR-007**: Every standalone post the bot makes is text the owner wrote or approved word for word before it
  entered the queue; the bot generates and edits nothing at run time (spec 002 FR-003 stands). The digest and
  record posts are fixed templates over counts and slugs (spec 002 US4).
- **FR-008**: A queued post may carry a date. On its day it goes out ahead of undated posts; a dated post missed
  on its day is never posted later, and the owner is alerted once for it — also when the server was down for
  days, since a marker on the post, not the date of yesterday, decides.
- **FR-008a**: An Event Radar post carries, in the queue only, its source link and the date it was last checked;
  one last checked more than 7 days before its date is held and the owner alerted.
- **FR-009**: One original a day, whichever kind: a queued post, an owner's-call post, the Monday digest or the
  Friday record share the day's slot. A digest with nothing to say leaves it free. Dated posts are not put on
  Mondays or Fridays. The target, 4–5 originals a week, counts all four kinds.
- **FR-010**: On Fridays, one alert when fewer than four publishable posts remain (a low-water mark; missed or
  held posts do not count), and one on the day the last one goes out — never one a day while it stays low. Once a week the owner reviews the next seven days: events still scheduled, new originals added,
  stale ones removed.
- **FR-011**: Pool reposts drop from two a day to about two a week. Which days is configuration. Target: about
  70% of the account's posts are its own, over four rolling weeks — replies left out, native reposts counted
  against it, quote posts counted on their own. A target to steer by, never a quota.
- **FR-012**: Spec 002 User Story 4 (deadline digest and record counts) is built as written, on Monday and
  Friday.
- **FR-013**: Formats: Event Radar (a scheduled event with a public outcome, "scheduled for", never "will"),
  Explainers (what makes a prediction checkable), the record (US4), and Calls Worth Watching (another person's
  public prediction, quote-posted by the owner by hand and marked "not recorded by Vaticeno"). Calls Worth
  Watching are the owner's own act in the X app, not the bot's feed: constitution VI's fixed pool limits what the
  bot reposts, not what the owner quotes. X refuses such quote posts from the API anyway (spec 002 FR-004).
- **FR-014**: Calls shown from a list (owner, 2026-11-06; constitution VI 2.9.0): the account may show a recorded
  prediction — terms after the lock, verdict after the deadline — only when its author is on the list, never
  otherwise. Each post is written and approved by the owner once that fact exists, then queued; it names the
  claim by its slug, never @mentions the author, and reads as the author's call recorded on Vaticeno ("CALL ·
  recorded on Vaticeno"). Every call of that author in a period is shown, misses included, never only the hits.
- **FR-014a**: The list is configuration and holds the owner's X user id alone for now; checked when a post is
  queued and again when it goes out. Removing an id holds that author's queued posts and deletes nothing already
  out. How anyone else gets on the list is decided later. Whether a claim carries money is not checked for now
  (constitution VI: the money rule is set aside while the account grows).

**Voice**

- **FR-016**: Posts are in English; direct, a little playful, sceptical of vague predictions, neutral about
  teams, parties and market direction. Never a tip, odds, "bet now", "to the moon", fake urgency or a
  prediction of Vaticeno's own (constitution VI; `docs/content-rules.md`).
- **FR-017**: Wagers are described accurately when asked about — live, in USDC or USDT, no fee — and never
  promoted in the account's own posts.

**Measurement (US6)**

- **FR-018**: A weekly review from three sources: X's own dashboard (read by the owner; no paid API read), the
  site report (US1), and the database (claims recorded; distinct authors who tagged the bot, owner excluded).

### Key Entities

- **Queued original** (existing `feed_queue`): text, position, now an optional date; for an Event Radar also its
  source link and when it was last checked, kept for the owner and never posted.
- **Weekly review**: not stored; produced on request from the three sources.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can read the visits and page views of any day of the last month, and how many visits came
  from X where the browser said so, from the Cloudflare dashboard, within a minute.
- **SC-002**: From week 2 on, at least 4 originals go out every week, and the queue never runs empty without a
  Friday low-water alert first.
- **SC-003**: Over the four weeks from week 2, about 70% of the account's posts are its own (as FR-011 counts
  them).
- **SC-004**: By the end of week 4: profile, pinned post and three Lists in place; 30 or more of the researched
  accounts followed; four weekly reviews made.
- **SC-006**: From week 2, the owner records at least 2 predictions a week through the bot.
- **SC-005**: By the end of week 4, at least one person other than the owner tags the bot with a prediction in
  a week (from 0 today). A target to steer by, not a promise.
- **SC-007**: After a month, someone opening the profile can say what Vaticeno does, sees real examples of it
  working, and has a reason to follow — checked with two people who have never seen it.

## Assumptions

- The owner posts, quotes, follows and pins by hand; this spec only drafts those. Nothing here posts from a
  keyword search or replies unsolicited.
- X's dashboard (profile visits, impressions) is read by the owner; the X API's analytics are paid and not used.
- Cloudflare Web Analytics is free and works without moving the site to Cloudflare (owner's choice, 2026-11-06);
  the owner creates the Cloudflare account and its site token.
- The 280-character limit applies to queued originals, as today; an Event Radar of several events is split
  over days, or posted by hand.
- Out of scope: paid promotion, follow automation, AI-written posts at run time, a public stats page.
