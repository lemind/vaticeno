# Feature Specification: Stage 0 — Contract Core (offline)

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Stage 0 of Vaticeno (fully offline, no X calls): the core that turns a prediction into a locked, checkable contract and resolves it. Data model with lifecycle states and immutability after lock; normalizer plus checks runnable as a CLI over a fixture corpus; unclear-prediction handling, MVP = case A only (NEEDS INFO reply with what is missing, examples and the amend format; case B — an LLM-driven clarifying conversation — deferred); resolver proven on seeded historical claims (hypothesis D); public claim and author pages with raw counts only." Amended in session: **any topic can be recorded as long as it can be checked; no topic exclusions; evidence from several sources passes gates; one resolution per claim — evidence decides, or an LLM arbiter decides, or it is flagged for human review; tweet edits before lock count as amends (new `[AMENDED]` reply), after lock nothing changes.**

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

The operator feeds a prediction text (as it would appear on X). The system writes a contract (see
**Contract model**): **what must happen**, **by when**, **where the answer is read** and **how "no"
is shown**. A series of checks then decides: **recorded** (with the statement that will be judged,
rendered from the contract), **needs info**, or **rejected**.

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
3. **Given** "Arsenal win the 2026-27 Premier League, by 2027-05-31", **When** it is evaluated,
   **Then** it is recorded against that season and the official final table as the source. (The
   same text with "this season" and no date is needs info: the deadline would be derived from the
   league's schedule, which the MVP never does.)
4. **Given** a prediction whose deadline is less than 24 hours away (a sports match: before its 15 min
   lock), or a deadline more than 10 years away,
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
one or two concrete example rewrites tailored to the author's topic, and how to fix it: reply with
the prediction and a date. There is no command word — any reply from the author under the bot's
reply is the fix (an **amend**).

**Why this priority**: Most real predictions are vague. With open topics, vagueness is the norm
("cancer treatment by 2030"); if this reply is confusing, strangers never record (hypothesis A).

**Independent Test**: Feed vague fixtures; check each reply names what is unclear, includes
topic-specific examples that would themselves pass the checks, says to reply with a date and fits
the length limit; then feed a valid author reply and check the claim becomes a draft contract.

**Acceptance Scenarios**:

1. **Given** "cancer treatment by 2030", **When** it is evaluated, **Then** the outcome is needs info
   stating that the cancer type and what counts as a treatment are unclear, with examples such as
   "FDA approves a drug for pancreatic cancer by 2030-12-31".
2. **Given** "Musk lands on Mars soon", **When** it is evaluated, **Then** the reply says the
   deadline and the exact event are unclear and gives an example with both.
3. **Given** "I bet Trump gonna be next president", **When** it is evaluated, **Then** the outcome
   is needs info (no explicit date; "next president" is ambiguous) with an example that pins the
   event and date, such as "Donald Trump is sworn in as US President by 2029-01-20".
4. **Given** each example the system suggests, **When** it is evaluated as an amend, **Then** it
   would be recorded (examples must be valid contracts, not just prose).
5. **Given** a claim in needs info, **When** its author sends a valid amend, **Then** the claim
   becomes a draft contract, and this amend does **not** count against the amend limit.
6. **Given** a claim in needs info, **When** the amend is still unclear, **Then** the claim stays in
   needs info and one short reply is produced.
7. **Given** a claim in needs info with no valid amend within 24 hours, **When** time passes,
   **Then** the claim expires silently.
8. **Given** any needs-info reply, **When** it is produced, **Then** it follows a fixed frame
   (header, what is unclear, examples, amend format); only the unclear-items text and the examples
   are generated.

---

### User Story 3 - A locked claim is resolved correctly (Priority: P1)

When a locked claim's deadline has passed, sources are checked and each answer is stored as
evidence that must pass the gates. One resolution per claim follows (see **Resolution model**):
evidence decides (the contract's own primary source, or two established ones agreeing), or an arbiter model decides,
or the claim is flagged for human review. Proven on
seeded historical claims whose correct verdicts are known.

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
10. **Given** two established results sites both show the same final match result, **When**
    resolution runs, **Then** both pass the gates and the resolution is final without an arbiter.
11. **Given** passed evidence that contradicts, **When** resolution runs, **Then** the arbiter decides
    with notes, or, if it cannot, the resolution is flagged for human review and the claim stays open.
12. **Given** one passed primary item from the contract's own source (e.g. the league's own final
    table) and nothing contradicting, **When** resolution runs, **Then** the resolution is final.
13. **Given** only one passed established item and no primary one, **When** resolution runs, **Then**
    the resolution is flagged for human review.
14. **Given** the judge rates a page "primary" that is not on the contract's own source domain,
    **When** it is stored, **Then** it counts only as established.
15. **Given** a site whose evidence agreed with 5 final verdicts, **When** a later claim is resolved,
    **Then** that site is searched first, and its trust level is still rated per page.

---

### User Story 4 - The contract lifecycle is trustworthy (Priority: P2)

Every claim moves through defined states — parsing, needs info, draft, locked, resolving, resolved,
void, rejected, expired. Once locked, the contract cannot change. Before lock the author may amend a
valid draft at most twice; each successful amend restarts the wait before lock. An edit of the
original tweet before lock counts as an amend; after lock, edits and amends change nothing.

**Why this priority**: Immutability is the trust primitive; offline, it is proven by tests rather
than traffic.

**Independent Test**: Drive claims through every allowed and forbidden transition; verify allowed
ones succeed and forbidden ones are refused by the database.

**Acceptance Scenarios**:

1. **Given** a locked claim, **When** anything attempts to change its contract or deadline, **Then**
   it is refused.
2. **Given** a claim in a terminal state, **When** anything attempts to change its state, **Then** it
   is refused.
3. **Given** a draft claim, **When** its author makes a third successful amend, **Then** it is refused
   with one reply; failed amends never consume an attempt.
4. **Given** a draft, **When** 15 minutes pass after the last contract reply with no amend, **Then** it
   locks; an amend in that time restarts the 15 minutes.
5. **Given** a draft whose original tweet was edited, **When** lock time arrives, **Then** the claim
   does not lock: the edited text goes through the proposal and checks like an amend — if it passes
   and the limit allows, new contract, a new reply marked `[AMENDED] #slug`, the claim updated, the
   15 minutes restarted, and it counts toward the limit; if it fails the checks or the limit is
   reached, the claim expires with one reply. The old contract is never locked against an edited post.
6. **Given** a locked claim, **When** its original tweet is edited or an amend arrives, **Then**
   nothing changes.
7. **Given** a claim is locked, **When** lock happens, **Then** the tweet's version ID and text hash
   at that moment are recorded and never change afterwards.

---

### User Story 5 - Anyone can see a claim and an author's record (Priority: P3)

A public claim page shows the contract exactly as judged: statement, criterion, source, how "no"
is shown, created, lock and resolve times, deadline and countdown, status, each source's answer with
its proof, the arbiter's reason if sources disagreed, the final verdict, and a link to the original
post. A public author page lists the claims the person holds a position on, with raw counts.

**Why this priority**: "The site is the memory"; in Stage 0 it renders from seed data.

**Independent Test**: Open pages for seeded claims in each state and one seeded author; check every
listed element is present.

**Acceptance Scenarios**:

1. **Given** a resolved claim, **When** its page is opened, **Then** it shows the final verdict, every
   source's answer with its link, and the arbiter's reason when there was one.
2. **Given** an author, **When** their page is opened, **Then** it shows raw counts only — no
   percentage, ranking or comparison with other people.
3. **Given** an author page, **When** it is opened, **Then** it is addressed by the permanent X user
   ID (the display name comes from X from Stage 1; Stage 0 shows the ID).
4. **Given** any page, **When** it is rendered, **Then** it contains no copy of the original post text.

---

### Contract model

One contract is the single thing that is judged. Its fields are the only source of meaning:

| Field | Meaning |
|---|---|
| Subject | who or what the prediction is about (asset, team, drug, person, organisation) |
| Criterion | the yes/no condition that must become true |
| Deadline | a UTC instant; a bare date means 23:59:59 UTC that day |
| Evaluation window | always `(lock time, deadline]`: an event counts only if it occurs after lock and at or before the deadline |
| Source | where the answer is read (structured, below) |
| Negative condition | what establishes that the criterion did **not** become true |
| Resolution method | price feed or model |

The **statement** shown to authors and on pages is rendered from these fields by a fixed
template. It is never model-authored and never stored as canonical data, so it cannot drift from
what is judged.

**Source** is structured, not a free-text name:

| Part | Meaning |
|---|---|
| Name and locator | the issuing body and its record (e.g. the regulator's approvals database, a league's official final table, a price feed) |
| Kind | what kind of result it is (e.g. football results, regulatory decisions); a label only, it grants no trust. The locator's domain is the only web domain whose pages can count as primary |
| Scope | what the source covers (jurisdiction, competition, asset) |
| Entity identifier | the exact entity in that source (asset ID, team and season, product name) |
| Absence is meaningful | yes if "not listed in this source by the deadline" proves the criterion false (e.g. an official approvals register); no for sources that are not exhaustive (e.g. news) |
| Fallback | only a record from the same issuing body may replace the locator if it moves or disappears |

**Daily close** (price claims) = the closing price of the UTC calendar-day candle (00:00:00 to
23:59:59 UTC) from the contract's named price feed. The closes considered are those whose day ends
inside the evaluation window, so the deadline's own day is included. A day with no candle is a gap:
it never counts as above or below the threshold. HIT may come from any observed close; MISS needs a
close for every day the answer depends on. A gap that could change the answer means wait; still
missing 30 days after the deadline → flagged for human review. A gap never becomes MISS.

### Lifecycle

Only these transitions exist; every other one is refused. Terminal states: **rejected, expired,
resolved, void**.

| From | To | When |
|---|---|---|
| parsing | draft | the contract passes all checks |
| parsing | needs info | something is unclear |
| parsing | rejected | not a prediction, breaks X's rules, deadline out of range, or duplicate source post |
| needs info | draft | a valid amend from the author (does not count against the amend limit) |
| needs info | needs info | an amend that is still unclear |
| needs info | expired | no valid amend within 24 h of the needs-info reply |
| draft | draft | a valid amend, or an edit of the original tweet found at lock time (max 2 in total) |
| draft | locked | the lock time is reached |
| draft | expired | the deadline passes before lock, or an edit found at lock time fails the checks or exceeds the limit |
| locked | resolving | the deadline has passed and the resolver picks the claim up |
| resolving | resolving | a source is unavailable (no verdict; retried next run) |
| resolving | resolved | final verdict HIT or MISS |
| resolving | void | final verdict VOID |

The database enforces this table; it is the single authority. Code refuses the same transitions
early for clearer errors, and a test checks the two never differ.

**Lock time** = 15 minutes after the most recent contract reply to the author (acknowledgement or
`[AMENDED]` reply). A valid amend restarts it.

**Amends and edits before lock.** A reply from the author under the bot's reply (no command word:
the reply text is the corrected prediction), or an edit of the original tweet,
before lock time produces a new contract for the **same claim** (same slug): the bot never edits its
earlier reply, it posts a new reply marked `[AMENDED] #slug` with the new statement, the claim's
contract is replaced, and lock time restarts. Both count toward the limit of two. Edits are detected
by re-reading the original tweet once at lock time and comparing its version with the one the
contract was built from; if it changed, the claim does not lock and the edited text goes through the
proposal and checks like an amend; if it fails them or the limit is reached, the claim expires. The
old contract is never locked against an edited post. After lock, edits and amends change nothing.

### Resolution model

Two layers: **evidence** (what each source says) and one **resolution** (the verdict).

**Evidence.** After the deadline the system checks sources — for price claims only the price feed
(it is primary and enough on its own); for other topics web sources found by search (e.g. for a
football result, the league's own site and major results sites). Each source's answer is stored as an evidence item with its proof and is put
through **gates**, and gets a **trust level**: *primary* (the body that decides or records the
outcome), *established* (an outlet with its own reporting) or *weak* (never counts). There is no
fixed list of sites: the judge model rates each page and gives its reason. Code caps the rating —
only the price feed and pages on the contract's own source domain (fixed at lock) can be primary;
any other page counts at most as established, so a model can never make an arbitrary site decide a
claim alone. Sites **earn standing**: one whose evidence agreed with 5 or more final verdicts
becomes a *known source* and is searched first; standing never raises a trust level. Each item also records what
the source says: *hit*, *miss*, *pending* (a result exists but is not final yet), *irrelevant* (the
source does not answer the question) or *entity gone*; only hit and miss count toward an outcome.
Evidence is either a **record** (the source shows a result) or an **absence** (the result is not in a
source the contract marks as exhaustive, checked on or after the deadline). Gates: the source is not weak; the quote the model cites really appears in
the fetched page; the event date is inside the evaluation window (for absence evidence: the page is
the contract's own primary source, read on or after the deadline and marked exhaustive); the result is final, not a
projection; and it is independent of the other evidence (not the same story copied). Only evidence
that passes every gate counts.

**Resolution** (one per claim), from the evidence that passed:

Only the highest trust level present decides: when a primary item passed, established items are
shown but never count as a contradiction.

| Passed evidence | Resolution |
|---|---|
| at least 1 primary, all primary items agree | final (one primary source is enough) |
| no primary, 2 or more established agree, none contradicting | final |
| primary items disagree, or (no primary) established items disagree | an **arbiter model** reads them and decides, with notes; if it cannot decide, the resolution is flagged **needs human review** |
| only 1 established, no primary | flagged **needs human review** |
| none, though sources were checked, in two runs at least 24 h apart | final: VOID, insufficient evidence (after one such run: wait, results may be reported late) |
| a primary source shows the entity no longer exists in 3 separate runs | final: VOID, unresolvable (fewer runs: wait) |
| a primary source says the result is pending | wait and retry; still pending 30 days after the deadline → flagged **needs human review** |

- A source that cannot be reached produces no evidence; the claim waits for the next run.
- A claim flagged for human review stays open and is listed for the operator (command line in Stage
  0, an admin panel later). The human's decision and notes become the final resolution.

### Edge Cases

- Calendar phrases ("EOY", "next year", "by Christmas", "in 6 months", "Q3") count as an explicit
  deadline: each maps to one fixed UTC date by calendar rules alone. Event phrases ("this season",
  "next election", "after the merger") need a schedule to become a date, so they are needs info in
  the MVP. Both kinds are listed in the fixture corpus.
- A bare date means 23:59:59 UTC; the recorded statement says so.
- A sports claim must name a real, scheduled match (owner decision 2026-09-30): a web search confirms it and
  fills in the competition; an invented or unfindable match is NOT RECORDED.
- A crypto price target with a date is always recorded as a daily close (owner decision 2026-09-30):
  "hits", "touches", "would be" included. The RECORDED reply shows the exact terms, so the author can fix
  them within 15 min. Only a price without a date (or a date without a price) is needs info.
- Several news sites repeating one wire story count as one source, not independent confirmation.
- An announcement published before lock can still be valid evidence if the event itself happens
  after lock; what matters is when the event occurred, not when it was reported.
- The named source changes its URL or disappears: the model may use equivalent records from the same issuing body;
  if none can establish the outcome, the verdict is VOID.
- Subjective outcomes ("X will be the best", "Y will crush it") are needs info with examples of a
  measurable version.
- Source data corrected after resolution: the verdict stands on the evidence recorded at the time.
- Commitment phrasing without structure ("calling it now", "screenshot this") is needs info.

## Requirements *(mandatory)*

### Functional Requirements

**Contracts and checks**

- **FR-001**: System MUST turn a prediction text plus today's UTC date into a proposed contract with
  exactly the fields of the **Contract model** (including the structured source), plus a list of
  what is unclear. The displayed statement MUST be rendered from those fields, never generated
  separately.
- **FR-002**: Any topic MUST be accepted if it yields a contract that passes the checks; there is no
  category allow-list and no topic exclusion.
- **FR-003**: After every proposal the system MUST apply these checks, and the checks — not the
  proposal — decide the outcome: the text is a prediction; it complies with X's rules for content
  the bot republishes; an explicit deadline present (MVP: the author states it; it is never
  derived from an event); deadline more than 24 h away (a sports match: after the lock, and the match must
  start after the claim's last change — checked on the evidence); deadline within 10 years;
  nothing unclear; criterion is objectively decidable (a yes/no that two independent readers of the
  source would agree on); a structured source is present; the negative condition is stated;
  source post not already claimed. The model's self-reported confidence is recorded for analysis
  but is not a check.
- **FR-003a**: One source post MUST map to at most one claim. Concurrent or repeated summons for
  the same post MUST result in exactly one claim; later ones are rejected as duplicates pointing
  to it.
- **FR-004**: For crypto price contracts the system MUST support UTC daily close above/below a
  threshold, at the deadline or on any day before it, and MUST confirm the price feed answers for
  the asset before recording.
- **FR-005**: A proposal that fails structural validation MUST be retried once, then result in
  needs info.
- **FR-006**: The system MUST be runnable from the command line over the fixture corpus, reporting
  per-fixture expected vs actual outcome and an overall pass rate.

**Unclear predictions (case A)**

- **FR-007**: A needs-info outcome MUST produce one reply in a fixed frame: what is unclear, one or
  two example rewrites tailored to the topic, and the instruction to reply with the prediction and a
  date.
- **FR-008**: Every suggested example MUST itself pass the checks: each generated example is
  evaluated through the same proposal and checks as a real amend; failing ones are discarded and
  regenerated once; if none survive, the reply uses a fixed generic example. An unchecked example
  is never sent.
- **FR-009**: All replies MUST fit within X's post length limit and contain no link card; the public
  page link is plain text.
- **FR-010**: Amends — any reply from the claim's author directly under the bot's reply, the claim's post,
  the summon or an earlier fix (however deep the thread), no command word —
  MUST be accepted in needs info and in draft; replies from anyone else are ignored; the first
  successful amend from needs info MUST NOT count against the limit; at most two successful amends
  from draft; a failed amend MUST NOT consume an attempt.
- **FR-011**: A claim in needs info with no valid amend within 24 hours MUST expire with no reply.
- **FR-012**: The system MUST NOT hold a multi-turn clarifying conversation (case B is out of scope).

**Lifecycle**

- **FR-013**: Claims MUST move only through the transitions in the **Lifecycle** table; every other
  transition MUST be refused, and terminal states MUST never change.
- **FR-014**: The contract and deadline MUST be immutable after lock, enforced by the database. At
  lock the system MUST record the exact version of the user's tweet the contract was built from —
  its version ID and a hash of its text (never the text itself) — and these MUST never change.
- **FR-015**: An edit of the original tweet found before lock MUST be handled as an amend: the
  edited text goes through proposal and checks (new contract, new `[AMENDED]` reply, lock time
  restarted, counts toward the limit); if it fails them or the limit is reached, the claim MUST
  expire and MUST NOT lock the pre-edit contract; after lock, edits
  MUST NOT change anything. The bot MUST NOT edit its own earlier replies.
- **FR-016**: Lock MUST happen at the **Lock time** defined in Lifecycle, never earlier.
- **FR-017**: A deadline that passes before lock MUST end in expired, never in resolution.
- **FR-018**: Each claim MUST have a short public identifier (5 characters from an unambiguous
  alphabet, widened to 6 after repeated collisions).

**Resolution**

- **FR-019**: After the deadline the system MUST gather evidence from several sources as in the
  **Resolution model**. The price feed compares daily closes with the contract; for "any day before
  deadline" it checks every daily close in the evaluation window, fetched in full at resolution.
  Missing days are kept as gaps, never skipped: a MISS needs a close for every day the answer
  depends on.
- **FR-020**: Every evidence item MUST be put through the gates (trusted, quote found, in window,
  final, independent); only items passing every gate count toward the resolution. Gate results are
  stored with the item.
- **FR-021**: HIT requires passed record evidence that the event occurred inside the evaluation
  window. MISS requires passed record evidence of a final result contradicting the criterion, or
  passed absence evidence: the result is missing from a source the contract marks "absence is
  meaningful", read on or after the deadline. Absence anywhere else (e.g. "no news found")
  MUST NOT produce MISS.
- **FR-022**: Multiple reports tracing back to one original report MUST count as one source
  (independence gate).
- **FR-023**: Every evidence item MUST store a pointer to its proof, not the content: link, retrieval
  time, a fingerprint of the retrieved content, the price value where applicable, the search query,
  the event date, the resolver run it belongs to, and the model identity and instruction version.
  Each run's evidence is kept. HIT, MISS and contradictions are decided from the latest run only;
  the waiting rules (entity gone in 3 runs, nothing found in 2 runs 24 h apart, pending for 30 days)
  read the earlier runs too. A run whose search found nothing still writes one evidence item
  (search query, no link, "irrelevant"), so every run is countable. The model's quote is used only to
  run the quote gate and MUST NOT be stored.
- **FR-024**: An unreachable, erroring or malformed feed, model or search MUST produce no evidence;
  the claim is retried on the next run.
- **FR-025**: Each claim MUST have exactly one resolution, reached by the table in **Resolution
  model**: one passed primary item, or two or more passed established items agreeing → final; only
  the highest trust level present decides; disagreement within it → arbiter model decides with notes, or flags the resolution for human review if it
  cannot; a single passed established item without a primary one → flagged for human review; none →
  VOID (insufficient evidence); entity gone from a primary source in 3 separate runs → VOID (unresolvable). Every evidence item MUST carry a
  trust level (primary, established, weak) rated by the judge model with its reason, capped in
  code: primary only for the price feed or a page on the contract's own source domain, any other
  page at most established — and what it says (hit, miss, pending,
  irrelevant, entity gone). There MUST be no fixed list of trusted sites. Every HIT or MISS
  resolution MUST name the evidence item that established it.
- **FR-025a**: Each final HIT or MISS MUST add one confirmation, once per site per claim, to every
  site whose evidence matched it; a site's record starts at its first confirmation. A site with 5
  or more confirmations is a known source and MUST be searched first; standing MUST NOT change a
  trust level or decide a claim.
- **FR-026**: Resolutions flagged for human review MUST be listed for the operator; the operator
  decides from the command line (admin panel later), and the decision and notes become the final
  resolution. A final resolution never changes (enforced by the database); correcting one is
  deferred.

**Public pages**

- **FR-027**: A public claim page MUST show statement, criterion, source, "no" condition, created,
  lock and resolve times, deadline with countdown, status, every evidence item with its link, trust
  level and whether it passed the gates, the resolution with how it was reached (evidence, arbiter or
  human) and its notes, and a link to the original post.
- **FR-028**: A public author page MUST be addressed by the author's permanent X user ID and list
  the claims the person holds a position on with raw counts
  (recorded, resolved, right, wrong, void — derived from verdict and stance) — no percentages,
  rankings or comparisons.
- **FR-028a**: Every claim MUST have exactly one author position (agree), created with the claim;
  positions MUST be immutable.

**Data and compliance**

- **FR-029**: The system MUST NOT store or log content: not the text of X posts, and not quotes,
  excerpts or snapshots of external sources. It stores only IDs, links, hashes and its own derived
  contract. Fixture texts and recorded test responses are test inputs, not stored claim data;
  recorded responses never include fetched page text or quotes.
- **FR-030**: All times MUST be stored and compared in UTC.
- **FR-031**: Every model, search and data-feed call MUST be recorded with its cost, per claim.

### Key Entities

- **Claim**: one prediction from one source post. Post IDs and the author's X user ID (never text);
  the tweet version and text hash at lock; the contract (the Contract model fields; the statement is
  rendered from them); state; reject reason; amend count; lock and deadline times. Its verdict lives
  in its Resolution.
- **Position**: a person's stance on a claim — agree or disagree — with when they took it. The
  contract belongs to the claim, not to a person. In the MVP the only position is the author's
  (agree); others joining is deferred. A person's result is derived from the claim's verdict and
  their stance.
- **Evidence**: what one source said about a claim — hit, miss, pending, irrelevant or entity gone — with a link to
  it and a fingerprint of what was read (FR-023), its trust level (primary, established, weak) with
  the judge's reason, and the result of each gate; only fully passed evidence counts.
- **Source**: a site that confirmed at least one final verdict, and how many it confirmed; 5 make it
  a known source (searched first).
- **Resolution**: exactly one per claim — the final outcome (hit, miss, void), how it was reached
  (evidence, arbiter, human), the evidence item that established it, the arbiter's or human's notes,
  and whether it needs human review.
- **Fixture**: a test prediction text with its expected outcome and, where applicable, expected
  contract essentials; grouped by the failure mode it probes.
- **Seeded claim**: a historical locked claim with a known correct verdict (and frozen data for
  price claims), used to prove the resolver.
- **Cost event**: one billable call — provider, operation, units, cost — linked to a claim.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of a 100-example fixture corpus in real X language, spanning crypto,
  sports, health, science, tech, business, politics and culture, produces the expected outcome.
- **SC-002**: 100% of 60 seeded historical crypto claims resolve correctly, covering exact-threshold
  values, UTC day boundaries, series gaps and a delisted asset.
- **SC-003**: On a set of at least 60 seeded historical open-topic claims with known outcomes, model
  verdicts agree with the known answer at least 95% of the time, with fewer than 5% wrong HIT/MISS
  (a VOID where the answer was knowable counts as disagreement, not as a wrong HIT/MISS). The set
  is built to this minimum mix, so the score reflects the failure modes rather than easy cases:

  | Category | Min seeds |
  |---|---|
  | clear HIT | 8 |
  | clear MISS from a final result | 6 |
  | MISS from absence in a source where absence is meaningful | 5 |
  | correct answer is VOID (nothing knowable) | 5 |
  | event before lock (must not be HIT) | 4 |
  | event after deadline (must not be HIT) | 4 |
  | announcement before lock, event after lock | 4 |
  | conflicting reports | 4 |
  | copied wire stories (one source, many sites) | 4 |
  | source page changed after publication | 4 |
  | partial outcome | 4 |
  | ambiguous entity name | 4 |
  | technically true under another reading | 4 |
- **SC-004**: Every model answer in the seeded set cites proof that, on inspection, supports it.
- **SC-005**: 100% of needs-info replies name what is unclear, include at least one example that
  itself passes the checks, use the amend format and fit the length limit.
- **SC-006**: Zero verdicts are produced during a simulated feed, model or search outage.
- **SC-007**: Zero attempts to change a locked contract, a terminal state or a position succeed.
- **SC-008**: Zero copies of content — X post text, quotes, excerpts or page snapshots — exist in
  stored data or logs after running the full corpus and seeds.
- **SC-009**: Every claim and author page for the seed data shows all required elements, and no page
  shows a percentage or ranking.
- **SC-010**: Every seeded case with contradicting passed evidence ends with either an arbiter
  decision with notes or a human-review flag; none is decided silently.

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
- Reply delivery, mention polling, rate caps and display names fetched from X are Stage 1+
  concerns; Stage 0 exercises lock and expiry timing with simulated times.
- `@vaticeno help` is recognised in Stage 0 on the submitted text; the X intake (Stage 1) must test the
  mention's own text, since the prediction is usually a different post.
- No paid live runs of the corpus or open-topic seeds (owner decision 2026-09-30): SC-001, SC-003 and
  SC-005 rest on the last recorded runs; the owner checks accuracy with a few real claims at release.
- Stage 0 reads the post at lock *time of the job* (usually within a minute of `lock_at`); an edit made in
  that gap counts as before lock. Stage 1's X reader must use each version's creation time and ignore
  versions created after `lock_at`. A draft that still can't be locked a day after `lock_at` expires with an
  alert.
- Extra commands (owner decision 2026-10-01), user-triggered replies like the rest: `@vaticeno selfpromo` →
  one of five fixed mottos plus a short AI-written joke (no gambling call to action); `@vaticeno quote` → only a
  real, attributed quote about bets, wagers, sport, bitcoin or predictions, found on the web and posted only
  if a page search returned contains it — never invented, never stored. Commands are matched in code, with a
  few aliases, small typos and up to 3 filler words ("selfpromote", "qoute", "quote 1", "stop please"); any
  content ("stop at 90k") makes it a prediction or a fix.
- Opt-out: `@vaticeno STOP` gets a STOPPED reply; the author stays opted out until they tag the bot again
  (owner decision 2026-09-30); their locked claims still resolve (constitution IV). Listed in the help reply.
- Edits to the original tweet count as amends before lock and are ignored after it. In Stage 0 the
  re-read is simulated from fixtures.
- Deadlines may be up to 10 years out (INIT_SPEC's 18-month cap is dropped).
- Out of scope: case B (clarifying conversation), accuracy percentages, leaderboards, payments,
  page-view tracking (hypothesis B, added when pages go public).

## Deferred (post-MVP, revisit after real-usage feedback on complex cases)

In the MVP evidence gates, the arbiter model and a human-review flag decide verdicts (FR-020–026). These are
deliberately left for later, to be designed from what real complex cases (e.g. elections) show:

- **Resolution tiers** assigned at recording: feed (prices) / official result (match results,
  regulatory approvals) / contested (elections, legal rulings, appointments).
- **"Final result" condition** for contested topics: the contract names what counts as final
  (e.g. a certified result), and resolution waits for it instead of reading projections.
- **Admin panel** for resolutions flagged for human review (MVP: listed and decided from the
  command line), targeting under 10% of resolutions.
- **Joining a claim**: anyone may reply in the thread to agree or disagree with a locked claim
  (e.g. "2 agree, 3 disagree"). One immutable position per person per claim; joins only on locked
  contracts (nobody bets on a contract that can still change); join time shown publicly. Author
  and claim pages then show every position and each person's derived result. Whether late joins
  need a cutoff is decided then. The data model already holds positions.
- **Correcting a final verdict**: an operator path to replace a wrong final resolution, with a
  public correction note. In the MVP a final resolution is frozen like the contract.
- **Early resolution**: in the MVP every claim is judged only after its deadline. Later, a trigger
  may re-check open claims periodically and declare HIT as soon as it happens (MISS still waits
  for the deadline).
- **Event-derived deadlines**: when a prediction names a scheduled event without a date ("next
  president"), the model derives the date and writes a "check from" (scheduled date) and a
  "check until" (latest date; still unknown then → VOID) into the contract, re-checking in
  between until the result is known. In the MVP the author must state the date (FR-003).
