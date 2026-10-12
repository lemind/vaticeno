# Tasks: The gates decide on the right event

**Input**: [spec.md](spec.md), [plan.md](plan.md) — the detail lives there; a task says what to build and
where, and names the requirement that defines it.

**Tests**: exhaustive on the gates and the resolver (001's rule: these decide verdicts). The three real
failures are fixtures. Nothing else.

**Commits**: `feat(004-T4NN): …`, one line.

## Status

| | |
|---|---|
| Cause 1 — an absence outranked records | fixed before this spec (001 T123, deployed 2026-10-12) |
| Cause 2 — same domain meant same story | this spec, Phase 2 |
| Cause 3 — no gate asked about the event | this spec, Phase 1 |
| Standing wrong verdict | one claim, corrected in Phase 4 |

## Format: `[ID] [P?] [Story] Description`

[P] parallelisable · US1 event identity · US2 grouping · US3 absence · US4 consistency

---

## Phase 1: US1 — the right event (P1) 🎯 MVP

**Independent test**: the meeting landing page showing Race 1 cannot decide a Race 2 claim; the
race-specific page can.

- [x] T401 **Done 2026-10-12.** [US1] `src/llm/instructions/judge.v5.md` + the v5 schema in `src/llm/judges.ts`: the event identifiers the page states, and finality meaning settled rather than authoritative. Rows judged under v4 keep their shape (FR-001, FR-010) `judge.v5` ships the five identity keys and redefines finality as settled-not-authoritative; v4 and earlier are read by their own schemas (`judgeSchemaFor`).
- [x] T402 **Done 2026-10-12.** [P] [US1] `src/resolve/relevance.ts` — pure: the contract's event key from `source.entity_id` and the criterion, and the match (yes / no / unknown) against what a page reported (FR-002, FR-012) `src/resolve/relevance.ts`, pure. The real contracts changed the rule: only the source entity may demand confirmation, because criteria carry deadlines (see FR-002).
- [x] T403 **Done 2026-10-12.** [US1] `relevant` gate in `src/resolve/gates.ts`: no match or unknown forces `irrelevant`, so such a page can never produce HIT or MISS (FR-003, FR-004) The gate fails the page and keeps what it said, rather than rewriting `says`: the claim page then shows why it did not count.
- [x] T404 **Done 2026-10-12.** [P] [US1] Migration `drizzle/0016_evidence_identity.sql` + `src/db/schema.ts` per plan.md → Data model: `event_identity` and `event_match` on the evidence row (FR-011) `drizzle/0016_evidence_identity.sql`, applied locally; four match values including `not_applicable`.
- [x] T405 **Done 2026-10-12.** [US1] Tests `src/resolve/relevance.test.ts` and the racing fixture: both real pages of the meeting, the title-only page as unknown, an open-topic claim falling back to the judge's own answer, the 60 price seeds untouched, and every new row carrying its identity and match (FR-014, SC-001, SC-003, SC-006) 10 unit tests on the matcher, one gate test, and two integration tests: the real racing run now resolves HIT off the Race 2 page, and a contract naming nothing comparable is judged as before. 119 unit + 149 integration pass.

**Checkpoint**: a page about another event cannot decide a claim. Proved on the real racing run: the Race 1 landing page fails the gate, the Race 2 page is no longer dropped behind it, and the verdict is HIT.

## Phase 2: US2 — the best page, not the first (P1)

**Independent test**: the same candidates judged in reverse order reach the same verdict.

- [x] T406 **Done 2026-10-12.** [US2] `src/resolve/groups.ts` — pure: group by site, near-duplicate text and credited origin; representative by event match, then completeness, then finality, then trust, never by what the page says (FR-005, FR-006) `independenceOf` ranks by match, then detail, then trust, with the url as a deterministic last resort.
- [x] T407 **Done 2026-10-12.** [US2] `src/resolve/gates.ts` and `src/resolve/web-evidence.ts`: `independent` and `sameStory` leave the per-page gate; judge all, gate all, then group (FR-005) `runGates` now leaves `independent` unassessed (null) and `groupPassed` decides it over the pages that passed.
- [x] T408 **Done 2026-10-12.** [US2] Two pages of one site that both match the event and disagree send the resolution to the arbiter: a conflict inside a group is never hidden by picking a representative (FR-006, FR-008a) Widened while testing: a disagreement escalates wherever both pages were placed, including contracts with nothing to match, which is most of them. A page that could not be placed never escalates anything.
- [x] T409 **Done 2026-10-12.** [US2] Tests: the reversed-order run, the racing group choosing the race-specific page, a wire story still counting once (SC-002) 8 grouping tests and two integration tests: the racing run reversed reaches the same HIT, and two conflicting official pages both survive to the arbiter. 125 unit + 151 integration pass.

**Checkpoint**: no verdict depends on judging order — proved by replaying the racing run with its pages reversed, and by three order-independence tests over the grouping rule.

## Phase 3: US3 and US4 — silence, and self-contradiction (P2)

**Independent test**: the stored fixtures-page rows cannot carry absence evidence; the self-contradicting row never publishes.

- [x] T410 **Done 2026-10-12.** [US3] `src/resolve/exhaustive.ts`: the endpoints recorded as complete official records, and the only path by which absence evidence is admitted. Starts empty (FR-007) Empty, with the reason and what an entry must prove written above it.
- [x] T411 **Done 2026-10-12.** [US3] `src/resolve/gates.ts`: a model-set `basis` no longer waives the quote check, and absence is admitted only by T410 (FR-007) One `admissibleAbsence` helper gates both the window and the quote waiver, and the predicate is injectable so a test can name an endpoint while the real list is empty.
- [x] T412 **Done 2026-10-12.** [US3] `src/resolve/decide.ts` keeps records outranking absences; a test proves an admitted absence never overrides a passed record, and the disagreement is logged rather than escalated (FR-008) `decide.ts` stays pure and returns `absenceDisagreed`; the resolver raises `resolution.absence_disagreed`.
- [x] T413 **Done 2026-10-12.** [US4] Where a page states a structured outcome and its identity is verified, code applies the locked criterion; a judgement contradicting its own result never counts and is reported (FR-009) `judge.v5` states the outcome in fields (`observed_result`); `src/resolve/consistency.ts` applies the criterion only for a plain "subject wins" shape with no margin, and a new `consistent` gate fails the row. 8 unit tests fix that boundary.
- [x] T414 **Done 2026-10-12.** [P] Tests: both football claims from their stored rows, the self-contradicting row escalating, and an absence still deciding when nothing contradicts it (SC-001, SC-004) Two integration tests: the football rows now resolve HIT with the silent page counting for nothing, and the self-contradicting row settles nothing. 134 unit + 153 integration pass.

**Checkpoint**: silence decides nothing on its own, and no verdict argues with its own evidence. With the list empty, a claim whose only evidence is an absence now waits and then voids, which is the safer failure.

## Phase 4: the verdict still standing

- [ ] T415 Re-judge the horse-racing claim with fresh pages (paid, ~$0.04) and correct it to HIT with `verdict:recheck --correct --post` (001 FR-035)
- [ ] T416 [P] Measure cost per resolved claim against the baseline and record it; one judging call per page and no second pass (FR-013, SC-005)
- [ ] T417 Mark tasks `[x]` with a one-line result; run the whole suite — unit, integration, typecheck

**Checkpoint**: nothing published is known to be wrong.

---

## Dependencies

```
T401 → T402, T403 → T405 → 🚀 Phase 1
T406 → T407 → T408 → T409 → 🚀 Phase 2
T410 → T411, T412 → T414 ·  T413 after T401
T415 after Phase 1 and Phase 2 (a re-judge is only worth paying for once the gates are right)
```

## Implementation strategy

Phase 1 alone would have prevented the wrong racing verdict, and Phase 2 alone would have let the right page
be seen — either is worth shipping without the other. Phase 3 changes no published verdict; it closes the
path that produced two of them. The standing correction waits for Phases 1 and 2, because paying to re-judge
before the gates are fixed buys the same mistake again.
