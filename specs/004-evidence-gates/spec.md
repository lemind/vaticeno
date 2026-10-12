# Feature Specification: The gates decide on the right event

**Created**: 2026-10-12

**Status**: Draft

**Input**: Owner report, 2026-10-12. Three of the first twelve published verdicts were wrong or could not be
settled, and all three failed in the evidence gates rather than in the model: a page about a different race
decided a horse-racing claim, and an official fixtures page that had not yet listed a match decided two
football claims against three outlets reporting the score. An outside review of the prompts, the gates and
the stored evidence followed; its conclusions are the basis of this spec.

## Context

A verdict is a public statement about a named person's prediction, posted once in their thread and never
edited. Getting one wrong is the most expensive thing this system can do, and it has now done it twice.

Neither failure was a model inventing something. In every case the right answer was among the pages we
fetched and judged, and the gates discarded it:

- the page that identified the race exactly was dropped for sharing a domain with the page judged before it;
- a page showing Race 1 was allowed to answer a question about Race 2;
- a page that had not listed a match outranked three that reported its score.

Three distinctions the current gates blur, and this feature draws:

1. the right source is not the right event;
2. the first page is not the best page;
3. an event missing from a page is not proof the event did not happen.

Nothing here adds a model call. Each page is already judged once; what changes is what the judge is asked to
report, and how those judgements are combined.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A page about another event never decides a claim (Priority: P1)

The judge reports which event the page it read is about — the competition, the round or race number, the
date, the venue, the participants it names. Code compares that with the event the locked contract names. A
page that is about something else, or that does not say which event it is about, cannot produce a verdict.

**Why this priority**: this is the defect that published a MISS for a horse that won its race.

**Independent test**: replay the two real pages — the meeting landing page showing Race 1, and the
race-specific page showing Race 2 — against the stored Race 2 contract. The first must not produce a verdict;
the second must.

**Acceptance Scenarios**:

1. **Given** a contract naming Race 2 at a named course on a named date, **When** a page showing Race 1 at
   the same course and date is judged, **Then** it counts as irrelevant and cannot decide the claim.
2. **Given** that same page, **When** it reports that the claim's subject is not listed on it, **Then** that
   is never recorded as MISS.
3. **Given** a page that names the race only by its title ("the Kam Tin Handicap"), **When** the page itself
   does not establish which numbered race that is, **Then** the match is unknown and the page cannot decide.
4. **Given** a page whose event identity cannot be determined at all, **When** it is judged, **Then** it
   fails closed: unknown is treated as no match.
5. **Given** an open-topic claim with nothing machine-comparable (an approval, a resignation), **When** the
   judge reports that the page is about that event, **Then** that judgement is accepted, because nothing
   stricter is available.

---

### User Story 2 - One site is one witness, but the best page of it (Priority: P1)

Every candidate page is judged on its own merits first. Pages are then grouped — same site, near-duplicate
text, same credited original report — and each group speaks once, through its most relevant page, chosen
without reference to what that page says.

**Why this priority**: the order pages happened to be judged in decided a public verdict.

**Independent test**: judge the same candidate set in reversed order and reach the same verdict.

**Acceptance Scenarios**:

1. **Given** three pages from the contract's own source, one of which identifies the contract's event,
   **When** the group's representative is chosen, **Then** it is that page, in any judging order.
2. **Given** two pages of one site that both identify the event and disagree about the outcome, **When** the
   resolution is decided, **Then** it goes to the arbiter rather than to whichever page was seen first.
3. **Given** a group of pages all repeating one wire story, **When** they are counted, **Then** they count
   as one source, as today.
4. **Given** any set of candidates, **When** representatives are chosen, **Then** the choice never considers
   whether a page says HIT or MISS.

---

### User Story 3 - Silence is not proof (Priority: P2)

A page that does not mention an event may be an official record that settles the matter, or a fixtures list
that has not refreshed. Only code knows which endpoints are exhaustive; the model can no longer decide that
it is reading one.

**Why this priority**: two wrong verdicts came from such a page. Preferring records over absences — already
shipped — stops the public damage but leaves the admission rule wrong.

**Independent test**: the stored fixtures-page rows for both football claims cannot pass as absence evidence
unless their endpoint is on the configured list.

**Acceptance Scenarios**:

1. **Given** a page the judge labels an absence, **When** its URL is not a configured exhaustive endpoint,
   **Then** it is not admissible as absence evidence.
2. **Given** a page labelled an absence, **When** the gates run, **Then** it is held to the same checks as
   any other page, so a label cannot waive one.
3. **Given** an admissible absence and a passed record that contradict each other, **When** the resolution is
   decided, **Then** the record decides, as deployed, and the disagreement is logged so the first real
   occurrence is visible.
4. **Given** no record and one admissible absence, **When** the resolution is decided, **Then** the absence
   may decide it, as today.

---

### User Story 4 - A verdict never contradicts its own evidence (Priority: P3)

Where a page states a structured outcome — a winner, a score — code applies the locked criterion to it
rather than accepting the judge's own verdict. A judgement whose stated result disagrees with its own HIT or
MISS never reaches a reply.

**Why this priority**: one stored row says MISS while its own result line says the claim's subject won. It
was discarded for another reason, so it did no harm this time.

**Independent test**: that stored row, replayed, is escalated and reported, never published.

**Acceptance Scenarios**:

1. **Given** a judgement saying MISS whose own result names the subject as the winner, **When** the gates
   run, **Then** it does not count toward a verdict and the disagreement is reported.
2. **Given** a page with a structured outcome and a verified event identity, **When** the verdict is
   computed, **Then** code computes it from that outcome and the locked criterion.
3. **Given** a claim with no machine-comparable outcome, **When** it is judged, **Then** the judge's
   classification stands, as today.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every judged page MUST report the identity of the event it describes — at minimum the date,
  plus whatever of competition, round or race number, venue and participants the page states — alongside its
  result. Identity is what the page says, never a conclusion about the contract.
- **FR-002**: Code, not the model, MUST decide whether a page's event is the contract's event, comparing what
  can be compared: the date and the round or race number. Only the source's **entity identifier** may demand
  confirmation from a page — it is the field whose job is naming the event. A date in the criterion is
  usually the deadline ("prints at 3.6% or lower on Oct 14 2026"), so requiring it would fail correct pages;
  a round named only in the criterion may contradict a page but MUST NOT be demanded of it. Where the
  contract names neither, the match is `not_applicable` and the judge's own answer stands — which is most
  claims, and they MUST NOT start failing closed.
- **FR-003**: A page whose event identity does not match, or cannot be determined, MUST count as irrelevant
  and MUST NOT produce HIT or MISS. Unknown fails closed.
- **FR-004**: A page that does not list the claim's subject MUST NOT produce MISS unless that page is both
  the contract's own exhaustive record (FR-007) and about the contract's own event.
- **FR-005**: Independence MUST NOT be decided page by page against the pages already accepted. Every
  candidate is judged and gated on its own merits; the survivors are then grouped by site, near-duplicate
  text and credited original report, and each group counts once.
- **FR-006**: A group's representative MUST be chosen by event match, then completeness, then finality, then
  trust level — never by what the page says. Two pages of one group that both match the event and disagree
  MUST send the resolution to the arbiter. A verdict MUST NOT depend on the order pages were judged in.
- **FR-007**: Absence evidence is admissible only from an endpoint recorded in code as exhaustive for that
  kind of event. A model-set field MUST NOT admit a page to the absence path, and MUST NOT waive any check
  that applies to other pages.
- **FR-008**: Records continue to outrank absences exactly as deployed (001 FR-034): when any record passed,
  the verdict comes from the records and absence evidence does not enter the comparison. This feature does
  **not** change that rule — it changes what may become absence evidence at all (FR-007). An admissible
  absence disagreeing with passed records is therefore not escalated, only logged; the allowlist starts
  empty, so the case cannot arise yet, and escalating a case that cannot occur is speculative machinery
  (review 2026-10-12). If the log shows it happening, that is the moment to decide, with the case in hand.
- **FR-008a**: Grouping MUST NOT hide a disagreement inside a source. One representative per group counts
  toward corroboration, but where two pages of one group were both placed and disagree about the outcome,
  the resolution goes to the arbiter rather than the inconvenient page being dropped (FR-006). Placed means
  the page matched the contract's event, or the contract named nothing to match it against — which is most
  claims, and a quiet place for the same mistake. A page that could not be placed escalates nothing.
- **FR-009**: Where a page states a structured outcome and its event identity is verified, that page's
  verdict MUST be computed in code from the outcome and the locked criterion. A judgement whose own stated
  result contradicts its HIT or MISS MUST NOT count, and MUST be reported.
- **FR-010**: The judge's finality field MUST mean the outcome is settled, not that the publisher is
  authoritative; authority stays with the trust level. A newspaper reporting a completed match reports a
  final result.
- **FR-011**: The identity a page reported, and whether it matched, MUST be stored with the evidence row, so
  a later rule change can be re-examined over stored evidence without paying to fetch and judge again
  (001 FR-035).
- **FR-012**: The contract schema MUST NOT change: a locked contract is immutable and claims already locked
  carry no new field. The event key is derived from the contract's existing source entity and criterion.
- **FR-013**: Nothing in this feature may add a model call per page or a second judging pass. The cost per
  claim MUST NOT rise.
- **FR-014**: Price-feed evidence is out of scope. It is not a judged page: the feed is the contract's own
  named source, read for one asset and one day, so there is no event identity to report and the `relevant`
  gate does not apply to it — as `quote_found` and independence already do not (001 FR-019, FR-020).

### Key Entities

- **Event identity**: what one page says about which event it describes — date, competition, round or race
  number, venue, participants — plus whether code found it to match the contract's event: yes, no, unknown,
  or not applicable when the contract names nothing comparable. Stored with the evidence row.
- **Source group**: the judged pages that count as one witness — one site, one near-duplicate text, or one
  credited original report — and the representative that speaks for it.
- **Exhaustive endpoint**: a URL pattern recorded in code as the complete official record for a kind of
  event. The only thing that may admit absence evidence.

## Success Criteria *(mandatory)*

- **SC-001**: The three real failures, replayed from the pages they were judged from, reach the right answer:
  the horse-racing claim HIT, and both football claims HIT rather than MISS.
- **SC-002**: The same candidate set judged in any order produces the same verdict, proved by a test that
  reverses the order.
- **SC-003**: No page failing the event match produces HIT or MISS, across the open-topic seeded set. The 60
  price-feed seeds are unaffected and MUST still resolve 100% correctly (001 SC-002, and FR-014 here).
- **SC-004**: No verdict in the seeded corpus rests on absence evidence from an endpoint not on the
  configured list.
- **SC-005**: The measured cost per resolved claim does not rise against the current baseline.
- **SC-006**: Every new evidence row carries its reported identity and match result, so a recheck can
  re-examine relevance for free.

## Assumptions

- The twelve verdicts already published carry no identity on their evidence rows, so relevance cannot be
  re-examined over them for free; re-examining one costs a fresh judging run (~$0.04).
- The arbiter model and the human-review flag already exist (001 FR-025, FR-026); this feature sends more
  cases to them rather than inventing a new escalation.
- Grouping is pure code over judged pages: nothing is fetched twice and no page text is stored
  (INIT_SPEC §6.9).
- The exhaustive-endpoint list starts nearly empty, on purpose. A verdict that would have rested on absence
  now waits or escalates, which is the safer failure.

## Out of scope

- Re-judging the whole history: only the one wrong verdict still standing is corrected.
- A general natural-language contradiction detector. FR-009 compares structured facts where they exist and
  reports where they do not.
- What counts as primary or established, and the search step that finds candidate pages.
