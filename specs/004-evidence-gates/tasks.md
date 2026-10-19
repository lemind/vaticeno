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
| Standing wrong verdicts | three found, all reaching HIT. The horse-racing one is corrected and posted; the two football ones are left as they are (T415) |

## Format: `[ID] [P?] [Story] Description`

[P] parallelisable · US1 event identity · US2 grouping · US3 absence · US4 consistency

---

## Phase 1: US1 — the right event (P1) 🎯 MVP

**Independent test**: the meeting landing page showing Race 1 cannot decide a Race 2 claim; the
race-specific page can.

- [x] T401 **Done 2026-10-12.** [US1] `src/llm/instructions/judge.v5.md` + the v5 schema in `src/llm/judges.ts`: the event identifiers the page states, and finality meaning settled rather than authoritative. Rows judged under v4 keep their shape (FR-001, FR-010) `judge.v5` ships the five identity keys and redefines finality as settled-not-authoritative; v4 and earlier are read by their own schemas (`judgeSchemaFor`).
- [x] T402 **Done 2026-10-12.** [P] [US1] `src/resolve/relevance.ts` — pure: the contract's event key from `source.entity_id` and the criterion, and the match (yes / no / unknown) against what a page reported (FR-002, FR-012) `src/resolve/relevance.ts`, pure. The real contracts changed the rule: only the source entity may demand confirmation, because criteria carry deadlines (see FR-002).
- [x] T403 **Done 2026-10-12.** [US1] `relevant` gate in `src/resolve/gates.ts`: no match or unknown forces `irrelevant`, so such a page can never produce HIT or MISS (FR-003, FR-004) The gate fails the page and keeps what it said, rather than rewriting `says`: the claim page then shows why it did not count.
- [x] T404 **Done 2026-10-12.** [P] [US1] Migration `drizzle/0016_evidence_identity.sql` + `src/db/schema.ts` per plan.md → Data model: `event_identity` and `event_match` on the evidence row (FR-011) `drizzle/0016_evidence_identity.sql`, applied to production 2026-10-13; four match values including `not_applicable`.
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

- [x] T415a **Done 2026-10-12.** `rejudgeClaim` + `verdict:recheck -- --slug X --rejudge`: fetches and judges the pages again, writes a new evidence run beside the frozen resolution, records what it spent, and never runs on a schedule. A free recheck only re-reads stored answers, so it can catch a wrong rule and never a wrong reading (004 T415a)
- [x] T415 **Done 2026-10-13.** Correct the standing verdicts with `--correct --post`. The horse-racing claim is corrected MISS → HIT and posted in its thread, after the re-judge ($0.051) placed the official race page and one established report on HIT and rejected the Race 1 page on relevance; the claim page shows the correction beside the superseded verdict. The two football claims flip on the stored rows alone and were left unposted by the owner: alpha, no readers, and three replies into strangers' threads buy nothing (owner decision 2026-10-13)
- [x] T416 **Done 2026-10-12.** [P] Measure cost per resolved claim against the baseline and record it; one judging call per page and no second pass (FR-013, SC-005) Measured in production over the ten resolved web claims: **1.00 judge call per judged page** (47 over 47), mean **$0.0662** a claim, worst **$0.0843**, ceiling $0.30. The v5 fields ride on the call already paid for. An integration test holds the one-call rule.
- [x] T417 **Done 2026-10-12.** Tasks marked with their results; 135 unit and 156 integration tests pass, typecheck clean. One task is left open on purpose: T415 spends money and posts publicly

**Checkpoint**: the verdict that was disputed in public is corrected in its thread. Two older football verdicts are known wrong and deliberately left: no audience to correct them for.

## Phase 5: two VOIDs that had their answer (2026-10-15)

Both claims went VOID on 2026-10-15 with `insufficient_evidence`. Neither lacked an answer.

- [x] T418 **Done 2026-10-15.** A same-day match recorded in the morning (e9vtp, Atlético Madrid 2–0 Manchester United): three established reports gave the score and the date but no kickoff time, and in_window refuses a lock-day event without one. The fixture check had the kickoff and dropped it. Now kept as `event_start_at` in the contract at recording and used by in_window when a page states only the date (`gates.ts`, `claims.ts`, `web-evidence.ts`). Gate tests cover it.
- [x] T419 **Done 2026-10-15.** A follower count on X (gzrt3, "@0xPaulvibe reaches 3k followers"): the normalizer wrote "author" for the account the post replied to, so web search looked for `"author"`. The account now comes from the post text — the @handle right before "N followers", or the poster when the post says I/my or names nobody — looked up on X for its numeric id and recorded as `x_profile` (`src/contract/x-profile.ts`). The contract's word "author" is never trusted: a first version did, read the poster's own count and wrote a wrong MISS (fixed the same day, never posted).
- [x] T420 **Done 2026-10-15.** `x_profile` claims are decided by one read of the follower count from the X API, not by search (`src/resolve/follower-evidence.ts`). The count at the read decides, whenever after the deadline it is made (owner decision 2026-10-15): X keeps no history, and above the threshold now is a HIT. A gone account is `entity_gone`; an API failure is an outage.
- [x] T422 **Done 2026-10-15.** A scheduled match counts from its date alone (owner decision 2026-10-15): recording finds the match and confirms it has not started, and an amend after kickoff is refused, so the claim itself proves the event came after the lock. Asking a result page for the kickoff as a second proof is what sent e9vtp to VOID with four reports in hand, and the fixture search answers inconsistently for a match already played — the same page passed at 05:38:22 and failed at 05:38:58. A kickoff a page does state still binds: one before the contract was set fails as before.
- [x] T423 **Done 2026-10-15.** A page code cannot place is still checked against its own result. The consistency gate (T413) only ran when identity came back `yes`, and identity is only demanded when the contract's entity names a round or a date — a football contract names neither, so every football page came back `not_applicable` and the gate never ran. With the kickoff requirement gone, four pages passed on e9vtp and two of them called "Atlético Madrid 2-0 Manchester United" a MISS of "Atlético Madrid beat Manchester United": self-contradicting, admitted, and enough to send the claim to the arbiter. Now `no` and `unknown` skip the check and `not_applicable` does not: the judge answered about our claim, so its answer is held against its own stated winner, and dropping a page fails closed.
- [x] T424 **Done 2026-10-15.** A standing verdict can be corrected by hand from the evidence already stored: `verdict:recheck --correct "<reason>" --outcome hit|miss --deciding-evidence <id>`, recorded as decided by a human, refusing an outcome that already stands or a row belonging to another claim. The table already held `decided_by`; only the evidence path could write it. Needed because e9vtp's rules now reach HIT while one more re-judge would pass the claim's $0.30 ceiling ($0.292 spent over four runs). **e9vtp: corrected VOID → HIT**, deciding row chosun.com, not posted.
- [x] T421 **Done 2026-10-15.** Both corrections posted in their threads: **e9vtp VOID → HIT** (2110640458116288931) and **gzrt3 VOID → MISS** (2110640504798917028). Needed a post-only path first — every branch wrote a correction before posting, so a row that already existed could not be sent. The reply is the correction and the result only, 163 and 111 of 280 characters; the stored reason stays on the claim page.
- [x] T425 **Done 2026-10-15.** A correction reply carries the claim, the change and the result, never the stored reason: that text is written for us, so it ran to 327 of 280 characters on e9vtp and named an account on gzrt3 (owner decision — the correction and the result, nothing invented).
- [x] T426 **Done 2026-10-15.** Two defects found reviewing this branch. The relaxed window gate rested on a proof that is skipped when the fixture search returns no kickoff: the deadline check only asks that the match day has not passed and defers the started-yet question to the gate, so a prediction posted after a match ended could record and resolve as a hit. Recording now refuses a match it cannot place in time, and the gate no longer discards a start time that disagrees with the page's own date. Second, running the consistency check on a page code cannot place (T423) also ran it on season-long claims, where one match's winner was compared against a title: "wins the <competition>" is now left alone while "beats <opponent>" is still checked. Also: a correction too long with its result line drops the line instead of throwing, as a verdict reply already does.
- [x] T428 **Done 2026-10-18.** Why two predictions of 2026-10-17 took three tries each, and why the account looked silent. (1) A t.co link reached the normalizer, and a dated result carrying one reads as a news headline, which the instruction tells it is not a prediction: both refusals had the link, the recorded attempt did not. The shortener carries no meaning, so it is now stripped with the handles. (2) Only needs_info and event_not_found bought a second look, so `not_prediction` was refused without ever reading the conversation that showed it was a call; the assessor had already called it a prediction on every one. (3) The feed was never broken — 26 reposts, two a day — but the last own-voice post was 2026-10-12: the Oct 6 token fault (EACCES, root-owned `.state/x-oauth.json`) left a `failed` row that retired queue position 3, and the job skips any item with a feed_posts row. The code was already right, since a post that never left the machine became PostNotSent on 2026-10-07; the one stale row was deleted by hand. Retrying a `failed` row was tried first and reverted: it breaks "never retry a post after a failed existence check" (INIT_SPEC §6.7). Quote posts remain off by design (`REPOST_SHARE = 1`, spec 002 T034: X refuses quoting a third party with 403).
- [x] T429 **Done 2026-10-18.** Review of T428 found the link strip had been applied to the mention body, which is what routing reads, not only what the model judges. Three control-flow regressions, all reproduced against the real code: "stop <link>" resolved to the STOP command and opted the author out for good; "ad <link>" answered with the bot's promo copy; a mention that was only a link normalised to empty, matched the points-at-parent test and recorded the parent post as a claim its author never submitted. The body is now left as posted and only the text the model judges is stripped. Also: the pattern dropped a t.co query string's parameters (`?s=20` survived), and a bracketed link is now taken with its brackets instead of being repaired afterwards. The paid second look for `not_prediction` is narrowed to a post carrying a digit, since that reason is the bucket every noise mention lands in and a conversation read costs about $0.05.

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
