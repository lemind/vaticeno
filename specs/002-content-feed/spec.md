# Feature Specification: Content feed

**Feature Branch**: `002-content-feed`

**Created**: 2026-10-05

**Status**: Draft

**Input**: Owner: the account's own feed must not be empty. Twice a day, repost the latest post of an
account from a fixed, weighted pool; sometimes quote it with a verified quote or a joke instead. Plus
owner-written originals and receipts. Overall goal: spend as little money as possible. See
`docs/content-rules.md` for identity, tone and the pool with its weights.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pool reposts (Priority: P1)

Twice a day the bot picks one account from a fixed pool of 15, by weight (higher-scored accounts come up
more often), takes its latest eligible post (not a reply or repost, at most 48 h old, never posted by us
before) and reposts it; if the account has none, another account is picked. About 1 time in 10 it quote-posts that post instead:
half of those with a verified quote that fits it, half with a short AI joke about it.

**Why this priority**: the profile needs visible, on-brand activity before anyone is invited, and this
needs no writing from the owner.

**Independent Test**: over many simulated picks, accounts come up in proportion to their weights, never
the same account twice in a row, never the same post twice, at most 2 a day.

**Acceptance Scenarios**:

1. **Given** the pool and weights, **When** 1,000 picks are simulated, **Then** each account's share is
   within a few points of its chance in the table.
2. **Given** the bot reposted @OptaJoe last time, **When** the next pick is made, **Then** it is another
   account.
3. **Given** the picked account's latest post was already reposted, or is older than 48 h, **When** the
   run happens, **Then** another account is picked (at most 3 tries; then nothing that run).
4. **Given** a quote-post turn and no verified quote can be fetched, or the joke breaks a rule, **When**
   the run happens, **Then** the post is reposted plainly instead.
5. **Given** dry-run mode (the default in code, off on the server), **When** a post is picked, **Then** it
   is recorded and logged for the owner, not posted.

---

### User Story 2 - Owner-written originals (Priority: P2)

The owner keeps a list of original posts (ON THE RECORD principles, HOW IT WORKS, jokes). The bot posts
the next unposted one at most once a day, at a varied time. No AI writes these.

**Why this priority**: originals carry Vaticeno's own voice and cost nothing to post besides X's fee.

**Independent Test**: with 3 queued posts, three days of runs post each once, in order, and then stop.

**Acceptance Scenarios**:

1. **Given** a queue of posts, **When** the daily slot comes, **Then** the next one is posted and marked.
2. **Given** an empty queue, **When** the slot comes, **Then** nothing is posted and the owner is alerted.

---

### User Story 3 - Receipts (Priority: P3)

When a claim gets a final verdict, the bot quote-posts its own verdict reply as a RECEIPT on the main
feed, at most 2 per day, so the profile shows the product working.

**Why this priority**: strongest proof once there are verdicts; depends on real usage.

**Independent Test**: a new final verdict with a posted verdict reply produces one RECEIPT quote post.

**Acceptance Scenarios**:

1. **Given** a final verdict whose reply was posted, **When** the receipts run, **Then** one RECEIPT quote
   post is made, once.
2. **Given** the author sent STOP, **When** the receipts run, **Then** no RECEIPT is posted for their claim.

### Edge Cases

- A pool account is renamed, suspended or protected: skip it, alert once, keep the rest (accounts are
  kept by numeric id, so a rename alone changes nothing).
- The latest post is a reply or a repost: not requested from X, so never picked.
- X rejects the repost or quote post (duplicate, rate limit): logged, not retried (one attempt per post);
  the day's slot is freed for the next run.
- The same post is picked by two runs at the same time: posted once.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The pool is a fixed list in configuration (numeric account id, handle, weight), owned by
  the owner; the bot never adds accounts. Weights are in `docs/content-rules.md` ("Repost pool").
- **FR-002**: Two runs a day at varied times; each picks one account at random by weight, never the
  account of the previous run, reads only that account's latest posts (no replies, no reposts) and takes
  the latest eligible one (≤ 48 h old, not posted by us before). None → pick another account, at most 3
  tries per run.
- **FR-003**: About 9 runs in 10 repost the latest post plainly; no AI call.
- **FR-004**: **Blocked by X since 2026-10-05**: quoting a pool account's post is refused with 403
  ("You can only reply to or quote posts where you are mentioned or are the author"), so every pool run
  reposts plainly and Vaticeno's own words appear only on posts it authored (receipts). If X's access
  changes, this returns as written: about 1 run in 10 quote-posts instead: half the time with a verified quote (the same
  checked source as the `quote` command, the AI only picks the topic), half the time with a short AI joke
  about the post. Our text: ≤ 200 characters, no tags, links or hashtags, no prediction of its own;
  anything that fails falls back to a plain repost.
- **FR-005**: Caps: at most 2 pool posts, 1 original and 2 receipts per day, never the same post twice.
  The caps and the never-twice rule are enforced by the database (a post or a day's slot is reserved
  before posting; a second reservation fails), not only by code checks. A post X rejects is never tried
  again, but it frees its day's slot: only posts that went out (or are in flight) count toward a cap.
- **FR-006**: The bot follows every pool account (once, by hand or through the API).
- **FR-007**: Dry-run is the default: picks are recorded for the owner to review and nothing is posted.
  A dry-run pick uses none of the day's cap, but it does count for "never the same account twice in a
  row" and "never the same post twice", so the rehearsal behaves like the real thing. Posting needs an
  explicit switch.
- **FR-008**: Every X read, AI call and post is recorded as a cost — by all three jobs, not only the pool
  one; a daily spend cap stops the whole feed for the day when reached.
- **FR-009**: Nothing is stored from other people's posts except their ids and the account handle.
- **FR-010**: Own-feed posting requires a constitution amendment (VI) before it is switched on.

### Key Entities

- **Pool account**: numeric id, handle, field, weight, enabled.
- **Feed post**: kind (repost, quote, original, receipt), day and slot, source post id or queue item,
  posted id, time. One row per source post and one per day's slot.
- **Queue item**: owner-written text, order, posted at.

## Success Criteria *(mandatory)*

- **SC-001**: Of the first 10 live picks, the owner keeps at least 8, and at most 2 are off-topic (not
  sport, crypto, forecasting, statistics or science). Checked on the posts themselves, not in a rehearsal
  (owner decision 2026-10-05): dry-run mode stays available, but going live needs no dry-run week.
- **SC-002**: The whole feed costs under $4 a month at full caps (X reads, posts and AI together),
  counting a repost at the post price ($0.015) until X's repost price is measured; UNRECONCILED until
  the dry run measures X's prices.
- **SC-003**: A visitor to the profile sees at least 10 own or curated posts before the first invite.
- **SC-004**: Text Vaticeno adds (quote lines, jokes, originals, receipt lines) never contains @mentions,
  links or hashtags and never makes a prediction of its own. Reposting or quoting another account's post is
  allowed.

## Assumptions

- The pool is the 15 accounts in `docs/content-rules.md`; `@CryptoHayes` (unavailable on X),
  `@ESPNStatsInfo` (the handle now carries a betting brand, not ESPN), `@_1woonomic` (dormant),
  `@saylor` and `@PeterSchiff` are left out. A handle can change hands, so the owner checks an account before it joins the pool.
- Reposting a pool post as-is is the owner's editorial choice: the latest post is reposted without an
  AI check, so the pool itself is what keeps the feed on-brand.
- X allows automated reposts and quote posts when they are not bulk, aggressive or spammy.
- Originals are written by the owner; no AI-generated original posts in this feature.
- Reading X through another service (Grok search) costs the same per post, and scraping is not
  allowed; the X API is the only source.
