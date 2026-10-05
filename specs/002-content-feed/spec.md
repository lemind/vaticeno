# Feature Specification: Content feed

**Feature Branch**: `002-content-feed` (not created yet)

**Created**: 2026-10-05

**Status**: Draft

**Input**: Owner: the account's own feed must not be empty. Occasional "Prediction spotted" quote posts
picked from a fixed pool of accounts, owner-written originals, and receipts. Overall goal: spend as
little money as possible. See `docs/content-rules.md` for identity, mix and tone.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prediction spotted (Priority: P1)

Once or twice a day the bot looks at recent posts from a fixed pool of 19 accounts, finds one that
contains a concrete prediction (a measurable outcome and a date or event), and quote-posts it with a
short fixed line: "Prediction spotted. Let's see how this one ages." Most days most posts are not
predictions; then nothing is posted.

**Why this priority**: the profile needs visible, on-brand activity before anyone is invited, and this
is the only content type that needs no writing from the owner.

**Independent Test**: run the selector against recorded pool posts; it picks only concrete predictions,
never the same account twice in a row, and posts at most the daily cap.

**Acceptance Scenarios**:

1. **Given** a pool post "NEW: Will Apple release a touchscreen MacBook this year?", **When** the selector
   runs, **Then** it is a candidate and may be quote-posted with a fixed line.
2. **Given** only product announcements and generic news in the pool, **When** the selector runs, **Then**
   nothing is posted that run.
3. **Given** the bot quoted @OptaJoe in the last run, **When** the next run picks a candidate, **Then** it
   is from another account.
4. **Given** the daily cap of 2 is reached, **When** another run happens, **Then** nothing is posted.
5. **Given** dry-run mode (the default at first), **When** a candidate is chosen, **Then** it is logged for
   the owner to approve, not posted.

---

### User Story 2 - Owner-written originals (Priority: P2)

The owner keeps a list of original posts (ON THE RECORD principles, HOW IT WORKS, jokes). The bot posts
the next unposted one at most once a day, at a varied time. No AI writes these.

**Why this priority**: originals are 55–65% of the planned mix and cost nothing to post besides X's fee.

**Independent Test**: with 3 queued posts, three days of runs post each once, in order, and then stop.

**Acceptance Scenarios**:

1. **Given** a queue of posts, **When** the daily slot comes, **Then** the next one is posted and marked.
2. **Given** an empty queue, **When** the slot comes, **Then** nothing is posted and the owner is alerted.

---

### User Story 3 - Receipts (Priority: P3)

When a claim gets a final verdict, the bot quote-posts its own verdict reply as a RECEIPT on the main
feed, at most a few per day, so the profile shows the product working.

**Why this priority**: strongest proof once there are verdicts; depends on real usage.

**Independent Test**: a new final verdict with a posted verdict reply produces one RECEIPT quote post.

**Acceptance Scenarios**:

1. **Given** a final verdict whose reply was posted, **When** the receipts run, **Then** one RECEIPT quote
   post is made, once.
2. **Given** the author sent STOP, **When** the receipts run, **Then** no RECEIPT is posted for their claim.

### Edge Cases

- A pool account is renamed, suspended or protected: skip it, alert once, keep the rest.
- A candidate is a reply, a repost, or older than 48 h: never chosen.
- A candidate mentions or tags someone in a hostile way, or is about gambling odds as a call to bet: discarded.
- X rejects the quote post (duplicate, rate limit): logged, not retried (one attempt per candidate).
- The same post was already quoted: never quoted again.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The pool is a fixed list in configuration, owned by the owner; the bot never adds accounts.
- **FR-002**: The bot reads only a few pool accounts per run, rotating, and only posts newer than the last
  one read from that account.
- **FR-003**: Cheap code filters run before any model call: no replies or reposts, at most 48 h old,
  must contain a number, a date or a future marker ("will", "by", "odds", "%", "next").
- **FR-004**: At most one model call per run, over all remaining candidates at once, returns the best
  one (or none) with a reason; only concrete, measurable predictions qualify.
- **FR-005**: Quote posts use a fixed line from a short owner-written list; the model never writes the
  post text. No @mentions in our text, no links, no hashtags.
- **FR-006**: Caps: at most 2 spotted posts and 1 original per day, never the same account twice in a
  row, never the same post twice; a random time within the day's windows.
- **FR-007**: Dry-run is the default: chosen candidates are logged for the owner; posting needs an
  explicit switch.
- **FR-008**: Every X read, model call and post is recorded as a cost; a daily spend cap stops the
  feed for the day when reached.
- **FR-009**: Nothing is stored from other people's posts except their ids and the account handle.
- **FR-010**: Own-feed posting requires a constitution amendment (VI) before it is switched on.

### Key Entities

- **Pool account**: handle, field (forecasting, statistics, crypto, sport), enabled, last read post id.
- **Feed post**: kind (spotted, original, receipt), source post id or queue item, posted id, time.
- **Queue item**: owner-written text, order, posted at.

## Success Criteria *(mandatory)*

- **SC-001**: In a two-week dry run, at least 80% of chosen candidates are judged by the owner as real,
  concrete predictions.
- **SC-002**: The whole feed costs under $3 a month at 2 spotted posts and 1 original a day (X reads,
  model and posts together); UNRECONCILED until X's per-read price is measured.
- **SC-003**: A visitor to the profile sees at least 10 own or curated posts before the first invite.
- **SC-004**: No post ever tags a third party or links out.

## Assumptions

- The pool is the 19 accounts in `docs/content-rules.md` ("Repost pool"), corrected: Willy Woo is now
  `@_1woonomic`, StatsBomb is `@Statsbomb`; `@saylor` and `@PeterSchiff` are left out for now.
- X allows automated quote posts for informational purposes when not bulk or aggressive.
- Originals are written by the owner; no AI-generated original posts in this feature.
- Reposts without a quote are out of scope: a quote post carries Vaticeno's voice.
