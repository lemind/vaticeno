# Feature Specification: Stage 0 — Contract Core (offline)

**Feature Branch**: `001-stage0-contract-core`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Stage 0 of Vaticeno (fully offline, no X calls): the core that turns a prediction into a locked, checkable contract and resolves it. Data model with lifecycle states, append-only history and immutability after lock; normalizer plus checks runnable as a CLI over a fixture corpus; unclear-prediction handling, MVP = case A only (NEEDS INFO reply with what is missing, examples and the amend format; case B — an LLM-driven clarifying conversation — deferred); resolver proven on seeded historical claims (hypothesis D); public claim and author pages with raw counts only." Amended in session: **any topic can be recorded as long as it can be checked; no topic exclusions; an LLM decides verdicts for topics without a data API, with no human confirmation step.**

## Context

Vaticeno's only product is trust: it records a prediction as a precise contract, freezes it, and
later judges it without anyone — including the bot — able to move the question.
**Any topic is allowed**, provided the contract states exactly what counts and where the
answer will be read. A language model writes that contract from the author's words, asks for
what is missing, and — for topics without a structured data feed — decides the verdict from
evidence it finds. Crypto prices keep a deterministic path because an exact feed exists.

Stage 0 builds and proves this core **without touching X**: predictions come from a fixture
corpus, contracts and verdicts are produced locally, and public pages render from local data. It
exists to answer one kill question before anything goes live: **can we referee correctly?**
(hypothesis D).

The operator in this stage is the project owner running the system by hand. Authors are
represented by IDs in fixtures and seed data.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Any clear prediction becomes a checkable contract (Priority: P1)

The operator feeds a prediction text (as it would appear on X). The system writes a contract with
four parts: **what must happen** (a precise, objectively decidable criterion), **by when** (a UTC
deadline), **where the answer is read** (a named authoritative source) and **how "no" is shown**
(what evidence would establish that it did not happen). A series of checks then decides:
**recorded** (with the exact statement that will be judged), **needs info**, or **rejected**.

**Why this priority**: Without a precise contract no verdict means anything. Open topics make this
the hardest and most important step.

**Independent Test**: Run the fixture corpus from the command line; each fixture's expected outcome
(and expected contract essentials, where given) is compared with the actual one and a pass rate is
reported.

**Acceptance Scenarios**:

1. **Given** "BTC daily close above $150,000 by 2026-12-31", **When** it is evaluated, **Then** it is
   recorded with the asset, comparison, threshold, deadline (end of day UTC), evaluation window and
   the price source.
2. **Given** "The FDA approves a drug for pancreatic cancer by 2030-12-31", **When** it is evaluated,
   **Then** it is recorded with a criterion ("a new drug or indication for pancreatic cancer is
   approved by the FDA between lock and deadline"), the source (the FDA's official approvals
   record) and how "no" is shown (no such approval in that record by the deadline).
3. **Given** "Arsenal win the Premier League this season", **When** it is evaluated, **Then** it is
   recorded against a specific season and the official final table as the source.
4. **Given** a prediction whose deadline is less than 24 hours away or more than 18 months away,
   **When** it is evaluated, **Then** it is rejected with that reason.
5. **Given** a text that is not a prediction ("love this thread"), **When** it is evaluated, **Then**
   it is rejected as not a prediction.
6. **Given** the proposal step returns malformed output, **When** it is evaluated, **Then** it is
   retried once and, if still malformed, the outcome is needs info — never a crash.
7. **Given** a source post that already has a claim, **When** it is evaluated again, **Then** it is
   rejected as a duplicate and the result points to the existing claim.

---

### User Story 2 - An unclear prediction gets concrete examples (case A) (Priority: P1)

When a prediction cannot be judged as written — the deadline, the measurable threshold, the exact
subject, what counts as success or an authoritative source is missing or ambiguous — the system
does not guess and does not start a conversation. It sends one NEEDS INFO reply: what is unclear,
one or two concrete example rewrites tailored to the author's topic, and the one format that fixes
it: `amend <what happens> by <YYYY-MM-DD>`.

**Why this priority**: Most real predictions are vague. With open topics, vagueness is the norm
("cancer treatment by 2030"); if this reply is confusing, strangers never record (hypothesis A).

**Independent Test**: Feed vague fixtures; check each reply names what is unclear, includes
topic-specific examples that would themselves pass the checks, uses the amend format and fits the
length limit; then feed a valid amend and check the claim becomes a draft contract.

**Acceptance Scenarios**:

1. **Given** "cancer treatment by 2030", **When** it is evaluated, **Then** the outcome is needs info
   stating that the cancer type and what counts as a treatment are unclear, with examples such as
   "amend FDA approves a drug for pancreatic cancer by 2030-12-31".
2. **Given** "Musk lands on Mars soon", **When** it is evaluated, **Then** the reply says the
   deadline and the exact event are unclear and gives an example with both.
3. **Given** each example the system suggests, **When** it is evaluated as an amend, **Then** it
   would be recorded (examples must be valid contracts, not just prose).
4. **Given** a claim in needs info, **When** its author sends a valid amend, **Then** the claim
   becomes a draft contract, and this amend does **not** count against the amend limit.
5. **Given** a claim in needs info, **When** the amend is still unclear, **Then** the claim stays in
   needs info and one short reply is produced.
6. **Given** a claim in needs info with no valid amend within 24 hours, **When** time passes,
   **Then** the claim expires silently.
7. **Given** any needs-info reply, **When** it is produced, **Then** it follows a fixed frame
   (header, what is unclear, examples, amend format); only the unclear-items text and the examples
   are generated.

---

### User Story 3 - A locked claim is resolved correctly (Priority: P1)

When a locked claim's deadline has passed, the system decides a verdict — **HIT**, **MISS** or
**VOID** — and stores the evidence behind it. Crypto price claims are decided by comparing the
price feed with the threshold. Every other claim is decided by the language model, which looks for
evidence in the contract's named source (and corroborating sources), and must cite what it found.
Both paths are proven on seeded historical claims whose correct verdicts are known.

**Why this priority**: This is hypothesis D, the kill criterion.

**Independent Test**: Resolve every seeded claim and compare verdicts (and, for model-decided
claims, whether cited evidence supports the verdict) with the known answers.

**Acceptance Scenarios**:

1. **Given** a crypto claim "close above X, any day before deadline" where some daily close exceeded
   X, **When** it is resolved, **Then** the verdict is HIT with the first qualifying date and value.
2. **Given** a close exactly equal to the threshold for "close above", **When** it is resolved,
   **Then** the verdict is MISS (strictly above).
3. **Given** a value crossing the threshold only on a UTC day boundary, **When** it is resolved,
   **Then** the day is assigned by UTC date.
4. **Given** an open-topic claim where the event demonstrably happened between lock and deadline,
   **When** it is resolved, **Then** the verdict is HIT with at least one cited source showing the
   event and its date.
5. **Given** an open-topic claim where the source demonstrably shows the event did not happen by
   the deadline (e.g. the official record or final result), **When** it is resolved, **Then** the
   verdict is MISS with that evidence cited.
6. **Given** an open-topic claim where no evidence either way can be found, **When** it is resolved,
   **Then** the verdict is VOID ("insufficient evidence") — never MISS.
7. **Given** evidence that the event happened before the claim was locked, **When** it is resolved,
   **Then** it does not count toward HIT; only events occurring after lock qualify.
8. **Given** the price feed, the model or its search is unreachable or returns malformed output,
   **When** resolution runs, **Then** no verdict is recorded and the claim waits for the next run.
9. **Given** a claim that was never locked when its deadline passed, **When** resolution runs,
   **Then** it is marked expired and never judged.

---

### User Story 4 - The contract lifecycle is trustworthy (Priority: P2)

Every claim moves through defined states — parsing, needs info, draft, locked, resolving, resolved,
void, rejected, expired — and every change is written to a history that cannot be edited or
deleted. Once locked, the contract cannot change. Before lock the author may amend a valid draft at
most twice; each successful amend restarts the wait before lock.

**Why this priority**: Immutability is the trust primitive; offline, it is proven by tests rather
than traffic.

**Independent Test**: Drive claims through every allowed and forbidden transition; verify allowed
ones succeed, forbidden ones are refused, and the history is append-only.

**Acceptance Scenarios**:

1. **Given** a locked claim, **When** anything attempts to change its contract, **Then** it is refused.
2. **Given** any history entry, **When** anything attempts to edit or delete it, **Then** it is refused.
3. **Given** a draft claim, **When** its author makes a third successful amend, **Then** it is refused
   with one reply; failed amends never consume an attempt.
4. **Given** a claim is locked, **When** lock happens, **Then** the exact source-post version is
   recorded and never changes afterwards.
5. **Given** a draft whose source post was edited before lock, **When** lock time arrives, **Then** the
   contract is re-evaluated and a clearly labelled "contract updated before lock" message is
   produced; if the edit no longer yields a checkable contract, the claim expires with one reply.

---

### User Story 5 - Anyone can see a claim and an author's record (Priority: P3)

A public claim page shows the contract exactly as judged: statement, criterion, source, how "no"
is shown, lock time, deadline and countdown, status, verdict with its evidence (links, observed
values and dates), a link to the original post, and the full timeline. For model-decided verdicts
the page states that the verdict was decided by a model and shows the cited evidence. A public
author page lists that author's claims with raw counts: recorded, resolved, hit, miss, void.

**Why this priority**: "The site is the memory"; in Stage 0 it renders from seed data.

**Independent Test**: Open pages for seeded claims in each state and one seeded author; check every
listed element is present.

**Acceptance Scenarios**:

1. **Given** a resolved claim, **When** its page is opened, **Then** it shows the verdict, how it was
   decided (price feed or model), the evidence, and every contract version with timestamps.
2. **Given** an author, **When** their page is opened, **Then** it shows raw counts only — no
   percentage, ranking or comparison with other people.
3. **Given** an author whose handle changed, **When** their page is opened by ID, **Then** it still
   resolves and shows the new handle as display text.
4. **Given** any page, **When** it is rendered, **Then** it contains no copy of the original post text.

---

### Edge Cases

- Temporal phrases ("EOY", "next year", "by Christmas", "this season", "in 6 months", "Q3") resolve to
  a specific UTC deadline or to needs info — each listed in the fixture corpus.
- A bare date means 23:59:59 UTC; the recorded statement says so.
- Intraday wording for prices ("wicks above", "touches") is needs info unless the author picks a
  daily close — the system never silently maps it.
- Several news sites repeating one wire story count as one source, not independent confirmation.
- An announcement published before lock can still be valid evidence if the event itself happens
  after lock; what matters is when the event occurred, not when it was reported.
- The named source changes its URL or disappears: the model may use equivalent official records;
  if none can establish the outcome, the verdict is VOID.
- Subjective outcomes ("X will be the best", "Y will crush it") are needs info with examples of a
  measurable version.
- Source data corrected after resolution: the verdict stands on the evidence recorded at the time.
- Commitment phrasing without structure ("calling it now", "screenshot this") is needs info.

## Requirements *(mandatory)*

### Functional Requirements

**Contracts and checks**

- **FR-001**: System MUST turn a prediction text plus today's UTC date into a proposed contract with:
  subject, criterion (what must happen), UTC deadline, evaluation window, named authoritative source,
  how "no" is established, resolution method (price feed or model), and a list of what is unclear.
- **FR-002**: Any topic MUST be accepted if it yields a contract that passes the checks; there is no
  category allow-list and no topic exclusion.
- **FR-003**: After every proposal the system MUST apply these checks, and the checks — not the
  proposal — decide the outcome: the text is a prediction; it complies with X's rules for content
  the bot republishes; deadline present; deadline more than 24 h away; deadline within 18 months;
  nothing unclear; proposal confidence at least 0.7; criterion is objectively decidable (a yes/no
  that two independent readers of the source would agree on); a source is named; how "no" is
  established is stated; source post not already claimed.
- **FR-004**: For crypto price contracts the system MUST support UTC daily close above/below a
  threshold, at the deadline or on any day before it, and MUST confirm the price feed answers for
  the asset before recording.
- **FR-005**: A proposal that fails structural validation MUST be retried once, then result in
  needs info.
- **FR-006**: The system MUST be runnable from the command line over the fixture corpus, reporting
  per-fixture expected vs actual outcome and an overall pass rate.

**Unclear predictions (case A)**

- **FR-007**: A needs-info outcome MUST produce one reply in a fixed frame: what is unclear, one or
  two example rewrites tailored to the topic, and the format `amend <what happens> by <YYYY-MM-DD>`.
- **FR-008**: Every suggested example MUST itself pass the checks when evaluated as an amend.
- **FR-009**: All replies MUST fit within X's post length limit and contain no link card; the public
  page link is plain text.
- **FR-010**: Amends from the claim's author MUST be accepted in needs info and in draft; the first
  successful amend from needs info MUST NOT count against the limit; at most two successful amends
  from draft; a failed amend MUST NOT consume an attempt.
- **FR-011**: A claim in needs info with no valid amend within 24 hours MUST expire with no reply.
- **FR-012**: The system MUST NOT hold a multi-turn clarifying conversation (case B is out of scope).

**Lifecycle and history**

- **FR-013**: Claims MUST move only through the defined states and transitions; forbidden
  transitions MUST be refused.
- **FR-014**: Contract fields MUST be immutable after lock, and the locked source-post version MUST be
  recorded at lock and never change.
- **FR-015**: Every state change and contract version MUST be appended to a history that cannot be
  edited or deleted.
- **FR-016**: Lock MUST NOT happen before both the challenge window (15 minutes after
  acknowledgement) and the source post's edit window (plus 60 seconds) have passed.
- **FR-017**: A deadline that passes before lock MUST end in expired, never in resolution.
- **FR-018**: Each claim MUST have a short public identifier (5 characters from an unambiguous
  alphabet, widened to 6 after repeated collisions).

**Resolution**

- **FR-019**: Crypto price claims MUST be resolved only by comparing the price feed with the
  contract; for "any day before deadline" the full daily series from lock to deadline MUST be checked.
- **FR-020**: All other claims MUST be resolved by the language model against the contract's
  criterion, named source and "no" condition, with no human confirmation step.
- **FR-021**: A model verdict of HIT MUST cite positive evidence that the event occurred between lock
  and deadline; MISS MUST cite evidence that it did not occur (the source's record or a final
  result); if neither can be established the verdict MUST be VOID with reason "insufficient evidence".
- **FR-022**: Multiple reports tracing back to one original report MUST count as one source.
- **FR-023**: Every verdict MUST store its evidence: sources consulted, what each showed, the event
  date, when it was observed, and the method (price feed or model, with model identity).
- **FR-024**: An unreachable, erroring or malformed feed, model or search MUST produce no verdict and
  MUST NOT change the claim's undecided count; the claim is retried on the next run.
- **FR-025**: A source that answers but no longer has the entity (e.g. delisted asset) MUST increment
  the undecided count; at 3 the verdict MUST be VOID with reason "unresolvable".
- **FR-026**: A manual override of a verdict MUST be possible for the operator and MUST be recorded
  in the history as an override.

**Public pages**

- **FR-027**: A public claim page MUST show statement, criterion, source, "no" condition, lock time,
  deadline with countdown, status, verdict with method and evidence, a link to the original post,
  and the full history timeline.
- **FR-028**: A public author page MUST be addressed by the author's permanent ID, show the current
  handle as display text only, and list claims with raw counts (recorded, resolved, hit, miss, void)
  — no percentages, rankings or comparisons.

**Data and compliance**

- **FR-029**: The system MUST NOT store or log the text of X posts — only post and user IDs and the
  system's own derived contract. Fixture texts are test inputs, not stored claim data.
- **FR-030**: All times MUST be stored and compared in UTC.
- **FR-031**: Every model, search and data-feed call MUST be recorded with its cost, per claim.

### Key Entities

- **Author (subject)**: an X user. Permanent user ID; handle as refreshable display name; opt-out
  flag and time.
- **Claim**: one prediction from one source post. Post and conversation IDs (never text); the
  contract (statement, criterion, deadline, window, source, "no" condition, resolution method); state;
  reject reason; amend and undecided counts; lock time and locked source-post version.
- **Claim event**: append-only history entry (created, needs info, amended, locked, resolve
  attempted, resolved, voided, expired, posted, post failed, manual override) with payload and time.
- **Resolution**: the single verdict — hit, miss or void — with method (price feed, model, manual),
  evidence list, notes and reply delivery state.
- **Fixture**: a test prediction text with its expected outcome and, where applicable, expected
  contract essentials; grouped by the failure mode it probes.
- **Seeded claim**: a historical locked claim with a known correct verdict (and frozen data for
  price claims), used to prove the resolver.
- **Cost event**: one billable call — provider, operation, units, cost — linked to a claim.
- **Page view**: an anonymous visit to a claim page (for hypothesis B), with referrer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of a 100-example fixture corpus in real X language, spanning crypto,
  sports, health, science, tech, business, politics and culture, produces the expected outcome.
- **SC-002**: 100% of 60 seeded historical crypto claims resolve correctly, covering exact-threshold
  values, UTC day boundaries, series gaps, retroactive corrections and a delisted asset.
- **SC-003**: On a set of at least 60 seeded historical open-topic claims with known outcomes, model
  verdicts agree with the known answer at least 95% of the time, with fewer than 5% wrong HIT/MISS
  (a VOID where the answer was knowable counts as disagreement, not as a wrong HIT/MISS).
- **SC-004**: Every model verdict in the seeded set cites evidence that, on inspection, supports it.
- **SC-005**: 100% of needs-info replies name what is unclear, include at least one example that
  itself passes the checks, use the amend format and fit the length limit.
- **SC-006**: Zero verdicts are produced during a simulated feed, model or search outage.
- **SC-007**: Zero attempts to change a locked contract or a history entry succeed.
- **SC-008**: Zero copies of post text exist in stored data or logs after running the full corpus.
- **SC-009**: Every claim and author page for the seed data shows all required elements, and no page
  shows a percentage or ranking.

## Assumptions

- Stage 0 makes no X calls. Posts, authors and summons are fixture IDs; replies are produced as text
  and checked, not posted.
- The language model and its web search are called during Stage 0; runs can also replay recorded
  responses so the corpus and seeded sets are repeatable without cost.
- Seeded open-topic claims use real past events with unambiguous, documented outcomes (approvals,
  launches, match results, election results, published statistics), resolved as if their deadline
  had just passed.
- Crypto prices come from one public feed's UTC daily close; seeded price claims use frozen copies of
  historical data so results never drift.
- Model-written NEEDS INFO text and model-decided verdicts make Vaticeno an AI reply bot under X's
  developer rules; written approval from X is required before these replies go live (Stage 1+).
- Reply delivery, live lock timing against real edit windows, mention polling and rate caps are
  Stage 1+ concerns; Stage 0 models the fields and rules and exercises them with simulated times.
- Out of scope: case B (clarifying conversation), accuracy percentages, leaderboards, payments.
