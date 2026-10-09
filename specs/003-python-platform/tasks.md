# Tasks: Visibility, settlement and cost

**Input**: [spec.md](spec.md), [plan.md](plan.md), [data-model.md](data-model.md)

**Tests**: exhaustive on the fast-path gate (it can finalise a verdict) and on every branch of the contract's
settle and refund (it moves funds). Three tests for the status page — healthy, dead job, no database. Nothing
else. ~55% coverage is a cap, not a floor.

**Commits**: `feat(003-T0NN): …`, one line.

## Status

| | |
|---|---|
| Stage 1 | not started — T001 blocks it |
| Stage 2 | not started; testnet only, no real value, no fee. Price-feed claims only; real value is a separate decision (FR-031h) |
| Escrow v1 | T026a must answer FR-031f before anything is deployed — a live contract gains nothing later |
| Stage 3 | not started; may end at T044 |
| `docs/decisions/` | created by T001 |
| `verifier` dependency group | added by T042, once the runtime is chosen |

## Format: `[ID] [P?] [Story] Description`

[P] parallelisable · US1 status page · US2 capacity · US4 settlement and wallet links · US3 verifier

---

# Stage 1

## Phase 1: Setup

- [ ] T001 Amend constitution VII (2.5.0 → 2.6.0) per plan.md → Complexity Tracking, record `docs/decisions/001-second-runtime.md`, bump the version in `CLAUDE.md`. **Blocks every Python task.**
- [ ] T002 [P] Get owner approval for the new dependencies in plan.md → Technical Context
- [ ] T003 [P] Root `pyproject.toml` (3.12, ruff, pytest) with `status` and `load` groups. `.gitignore`: `__pycache__/`, `.venv/`, `*.pyc`, `load/results/`, `verifier/model/`, `verifier/eval/data/`, `.build-info.json`
- [ ] T004 [P] Python job in `.github/workflows/test.yml`: `ruff check .`, `pytest status load` (FR-021)

## Phase 2: Foundational

- [ ] T005 Migration `drizzle/0014_job_state.sql` + `src/db/schema.ts` per data-model.md, including the `status_ro` SELECT policy; apply locally, then Supabase
- [ ] T006 `runJob` in `src/jobs/scheduler.ts` writes `job_state`; a lock skip writes `last_locked_at` only (FR-001, FR-020)
- [ ] T007 `stale_after_seconds` per job beside `SCHEDULES`, overwritten on startup; seed all eight rows (FR-001, SC-002)
- [ ] T008 `deploy/deploy.sh` writes `.build-info.json` on the server after the rsync — commit SHA, deploy time, `node --version`. Build info only; the units install with the tasks that create them (FR-002)
- [ ] T009 `deploy/status-role.md` (`CREATE ROLE` + `GRANT SELECT`, run once by hand) and migration `drizzle/0015_status_policies.sql` — RLS is on with no policies, so a grant alone returns zero rows. `DATABASE_URL_RO` empty in `.env.example` (FR-003)
- [ ] T010 [P] Test `tests/integration/job-state.test.ts`: success, failure with its tag, lock skip leaves the outcome untouched, never-run

**Checkpoint**: all eight jobs report state; the deploy records what it deployed.

## Phase 3: US1 — the status page (P1) 🎯 MVP

**Independent test**: stop one job, or kill the database, and the page names what is broken.

- [ ] T011 [US1] `status/queries.py`: one function per block — job staleness, claims, verdicts with the review backlog, feed today, spend against the per-claim ceiling
- [ ] T012 [US1] `status/build_info.py`, `status/progress.py`: read `.build-info.json` and `docs/progress.md`, tolerate both missing, return the progress file's mtime (FR-002, FR-007)
- [ ] T013 [US1] `status/app.py`: FastAPI, two routes `/` and `/status.json`, bound to `127.0.0.1`, renders when the database is down (FR-005, FR-006)
- [ ] T014 [US1] `status/templates/`: one screen at 1280px, no scrolling, overall state first, progress block last (SC-001)
- [ ] T015 [US1] `docs/progress.md`: stage / done / now / next, seeded with where the project stands
- [ ] T016 [P] [US1] `deploy/vaticeno-status.service` + its install line in `deploy/deploy.sh`; never in `deploy/Caddyfile` (FR-004)
- [ ] T017 [US1] `status/tests/test_status.py`: healthy, stale job, database down. Fixtures are rows, not a running service
- [ ] T018 [P] [US1] `README.md`: the status page and its tunnel command

**Checkpoint**: Stage 1's page ships. Use it for a week before Phase 4.

## Phase 4: US2 — the capacity baseline (P1)

**Independent test**: a load run produces a table that can be re-run after a change.

- [ ] T019 [US2] `load/guard.py`: refuse a non-local target or any real credential in the environment (FR-008)
- [ ] T020 [US2] `load/locustfile.py`: claim and author pages plus `/healthz`, ramped until p95 degrades (FR-009)
- [ ] T021 [US2] `load/burst.py`: stubbed X reader and a temp `statePath`, ten times the live mention rate, one reply each; record `replied_tweet_ids` growth (FR-010, SC-004)
- [ ] T022 [US2] Measure the connection ceiling: raise concurrency past the pool and record whether it queues, refuses cleanly or wedges, and how long recovery takes
- [ ] T023 [US2] Measure peak RSS per process under load — Node with its jobs, the status service — against the box's memory, and state the headroom (SC-008)
- [ ] T024 [US2] `capacity.md`: every row with its number, hardware and date; laptop and droplet separately (SC-003)
- [ ] T025 [US2] Replace the UNRECONCILED labels these runs answer, with the date (FR-011)
- [ ] T026 [P] [US2] `README.md`: how to run a load run locally

**Checkpoint**: the numbers exist and the droplet's headroom is known.

**🚀 Stage 1 deploys here.**

---

# Stage 2

## Phase 5: US4 — settlement on a testnet (P3)

**Independent test**: two addresses stake equally on a recorded claim; after the deadline the verdict pays the
winner with nobody touching a wallet. Then the same with VOID, and the same with the worker switched off for
the timeout window.

### Before a line of Solidity

- [ ] T026a [US4] `docs/decisions/002-escrow-v1.md` — answer every item of FR-031f in writing, because a deployed contract cannot gain any of them: terminal states and no double settlement, permissionless payout after the window, the void path, the timeout refund, expiry of an unmatched stake, the maximum stake, the fee ceiling and recipient, what happens when the oracle key is lost or compromised, whether new stakes can be stopped without blocking refunds owed, and which events carry the verdict and reason references. The same document records what must be true before any real value is involved — a legal opinion for the operator's own country, an independent reading of the contract, and a written incident policy — so that decision is never taken by momentum (FR-031f, FR-031h, SC-019)
- [ ] T026b [US4] The settlement window and the void policy, written down and published: how many hours the contract holds a verdict before payout, the grounds a void needs, the reason codes, and the sentence that says a complaint alone pauses nothing (FR-031b, FR-031c, FR-031e)
- [ ] T026c [US4] Say what the thing is, everywhere it is described: an escrow with a named referee and a published settlement policy, never trustless or impartially arbitrated — README, the spec, and the explainer page (FR-031g)

### The contract

- [ ] T027 [US4] Contract toolchain and `contracts/` skeleton; **one network and one stake token**, its testnet RPC and chain id in `.env.example`, no key in git (FR-022, FR-036)
- [ ] T028 [US4] `contracts/src/Escrow.sol`: `open`, `accept`, `settle`, `void`, `refund`, `expire`; equal stakes, per-stake cap, a fee ceiling and a fixed recipient, a settlement time stored with the verdict, payout callable by anyone after it, a timeout refund anyone can trigger, **no withdrawal path** (FR-023, FR-024, FR-026, FR-030, FR-031b, FR-031f)
- [ ] T028a [US4] `void` in `contracts/src/Escrow.sol`: callable by the oracle address only, only while the settlement window is open, refunds each side its own stake and has no branch that pays either party, the operator or a fee. Void and the timeout refund are separate transitions (FR-031c, FR-031d)
- [ ] T029 [US4] Contract tests: every branch of settle, void, refund and expire; a second settle rejected; payout refused before the window and accepted from an unrelated address after it; a void inside the window refunding both and paying nobody; a void after it refused; an unmatched stake recovered by its maker; and a test that tries and fails to move staked funds (SC-013, SC-014, SC-018)
- [ ] T030 [US4] Deploy to the testnet with the source verified publicly; record the address in `.env.example` and on the status page (FR-029)

### The settlement path

- [ ] T031 [US4] Migration `drizzle/0017_settlement.sql` + `src/db/schema.ts` per data-model.md: `settlement_outbox` with its `status_ro` policy
- [ ] T032 [US4] `src/resolve/resolver.ts` writes an outbox row when a verdict is final and a stake exists; no chain call from Node (FR-027)
- [ ] T033 [US4] `settle/worker.py`: poll the outbox, read on-chain state first, sign, send, record the transaction; its own systemd unit, the key from the environment and nothing else in the process (FR-025, FR-028)
- [ ] T034 [US4] Test `tests/integration/settlement-outbox.test.ts`: a final verdict with no stake writes nothing; a replayed row sends nothing twice (FR-026)
- [ ] T035 [US4] Status page: outbox pending / sent / failed, the contract address, the chain (FR-029)
- [ ] T036 [US4] The fast path never settles: a verdict decided by the local verifier alone does not produce an outbox row (FR-031)
- [ ] T036a [US4] Only price-feed claims can be staked: the contract refuses a stake on any other claim, the page never offers one, and the outbox refuses to write one. Tested by trying on a model-judged claim (FR-031a, SC-017)
- [ ] T037 [US4] End to end on the testnet — open, accept, deadline, verdict, payout — then VOID, then the timeout refund with the worker stopped (SC-010, SC-011, SC-012)

### Linking a wallet, optional

- [ ] T038 [US4] Migration `drizzle/0018_wallet_links.sql` + `src/db/schema.ts` per data-model.md: `wallet_links`, partial unique index on an active address, `status_ro` policy (FR-032)
- [ ] T039 [US4] The link flow: a page issues a single-use code, the bot verifies the code's reply through the API and binds the numeric author id, the page **shows that account and requires a confirm**, then takes the signature privately; a code returned by any other account is discarded (FR-033, FR-034, FR-035)
- [ ] T040 [US4] Test: a link is written only when both halves check out; a code returned by a different account writes nothing; revoking leaves the row and its period intact; a stake opens and settles with no link at all (SC-015, SC-016)

**Checkpoint**: a verdict settles a contract on a testnet, and money cannot be stuck: the timeout refund works with nothing of ours running.

**🚀 Stage 2 deploys here** — testnet only, no real value, no fee.

**Real value is not in this feature.** It needs a legal opinion for the country the operator lives in
(the betting-intermediary role and the event types offered), an independent reading of the contract, and
a written policy for oracle compromise, source corrections, voids and refunds. ESMA's statement of
3 July 2026 puts event contracts that are financial instruments under the permanent national
binary-options bans, and says a new name does not avoid them (FR-031h).

---

# Stage 3

## Phase 6: US3 — the local verifier (P2)

**Independent test**: zero wrongly auto-finalised claims on the held-out set, with the avoided-call share reported.

### Offline

- [ ] T041 [US3] `verifier/eval/dataset.py`: held-out set from seeded claims and real verdicts, written to gitignored `verifier/eval/data/`; report its size
- [ ] T042 [US3] `verifier/eval/baseline.py`: stock model, thresholded by one rule — the highest fast-path coverage at zero wrong auto-finalisations. Report model level (entailment, latency, memory) and **fast-path level** (coverage, wrong auto-finalisations, calls avoided). Add the `verifier` group and its pytest path
- [ ] T043 [US3] `verifier/train/finetune.py` + `config.toml` + `train/report.md`: fixed seed, named dataset, the exact command, weights fetched by checksum and never committed (FR-019)
- [ ] T044 [US3] `verifier/eval/compare.py` → `eval/report.md`: both candidates, both levels, winner chosen on the fast-path numbers (FR-019, SC-005, SC-006)

**Checkpoint**: one report, one decision, nothing in production. The feature may stop here.

### Shadow

- [ ] T045 [US3] Migration `drizzle/0016_verifier.sql` + `src/db/schema.ts` per data-model.md: `verifier_shadow` with its append-only trigger and its `status_ro` policy, the two `resolutions` columns (FR-015, FR-016)
- [ ] T046 [US3] `verifier/serve/app.py`: one endpoint, no database, `127.0.0.1:3002`; `deploy/vaticeno-verifier.service` + its install line (FR-020)
- [ ] T047 [US3] `src/resolve/verifier.ts`: short timeout, Zod-parsed, "no opinion" on any failure (FR-012)
- [ ] T048 [US3] Shadow mode in `src/resolve/resolver.ts`: ask, **ignore**, record one row per attempt — what the gate would have concluded, beside what the paid model did; `VERIFIER_URL` and `VERIFIER_MODE` (`off|shadow|live`, default `off`) in `src/config.ts`
- [ ] T049 [US3] Test `tests/integration/verifier-shadow.test.ts`: a shadow run leaves the resolution row byte-identical, writes exactly one shadow row, and UPDATE or DELETE on that row is rejected

**Checkpoint**: shadow rows accumulate; no verdict has changed.

**🚀 Stage 3 deploys here, first of two — shadow, deciding nothing.**

### Live

- [ ] T050 [US3] `src/resolve/fast-path.ts`: the gate — threshold, two items 001's independence gate calls independent, every deterministic check, no numeric/date/entity conflict; else escalate; absence stays VOID (FR-013, FR-014)
- [ ] T051 [US3] Test `src/resolve/fast-path.test.ts`: **exhaustive** — entail+entail eligible, entail+neutral and entail+contradiction escalate, contradiction+contradiction only when the other gates permit; each condition failing alone escalates; one page is one item; verifier error escalates; the gate and T042's harness agree on the same fixtures
- [ ] T052 [US3] `VERIFIER_MODE=live`: the fast path finalises and records who decided; off returns to today with no migration (FR-017, SC-009)
- [ ] T053 [US3] A fast-path verdict can be marked contradicted in the existing review (`src/cli/review-list.ts`, `src/cli/resolve-manual.ts`) (FR-018)
- [ ] T054 [US3] Verifier block on the status page: fast-path count, escalations, shadow agreement, contradictions as incidents (FR-018)
- [ ] T055 [US3] Record the avoided-call share and per-claim spend against the baseline in `eval/report.md` (SC-006, SC-007)
- [ ] T056 [US3] Re-measure memory with all three processes live and update `capacity.md` (SC-008)

**Checkpoint**: switched on, off, and on again, with SC-005 holding.

**🚀 Stage 3 deploys here, second of two — the switch on.**

---

## Phase 7: Polish

- [ ] T057 [P] `README.md`: the new services, and the Done/Next table for what shipped
- [ ] T058 [P] Mark tasks `[x]` with a one-line result; sync plan.md and data-model.md where implementation diverged
- [ ] T059 Run the whole suite — node tests, integration, typecheck, ruff, pytest

---

## Dependencies

```
T001 ─ blocks all Python work
  └─ Phase 2 (T005–T010) → US1 (T011–T018) → 🚀 Stage 1
                              US2 (T019–T026) ┘
US4 contract (T027–T030) → settlement path (T031–T037) → links, optional (T038–T040) 🚀 Stage 2
US3 offline (T041–T044) → shadow (T045–T049) 🚀 → live (T050–T056) 🚀
```

US1 and US2 are both P1 and independently shippable; US2 needs only Phase 2. **US3's offline evaluation runs
on a laptop** — T023's VPS measurement gates *deploying* the verifier, not evaluating it.

## Parallel opportunities

T002–T004 · T010 beside T008 and T009 · T016 and T018 once T013 exists · T026 beside the measuring tasks ·
T043 while T042's numbers are read · T057 beside T056.

## Implementation strategy

MVP is US1 alone: useful the day it ships, and what makes everything after it measurable. US2 turns estimates
into numbers. US3 may not ship at all, which is why its first checkpoint comes after four tasks.
