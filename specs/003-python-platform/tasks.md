# Tasks: Operations, capacity and cost

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: narrow on purpose. Exhaustive on the fast-path gate (it can finalise a verdict) and on the
lease/reservation behaviour the load runs exercise. The status page gets three tests — healthy, dead job, no
database — and nothing more. ~55% coverage is a cap, not a floor.

**Paths**: new Python lives in `status/`, `load/`, `verifier/`; TypeScript changes are confined to
`src/jobs/scheduler.ts`, `src/resolve/`, `src/db/schema.ts` and `drizzle/`. Commits: `feat(003-T0NN): …`,
one line.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished work)
- **[Story]**: US1 status page · US2 capacity baseline · US3 local verifier

## Deploy stages

Three deploys (plan.md → Deploy stages). **Stage 1** is Phases 1–4 here: the site can be seen and has been
measured. **Stage 2** is contract functionality and is a separate feature with its own tasks — no task below
belongs to it. **Stage 3** is Phase 5 here, and it deploys twice: shadow first, switch second.

---

# Stage 1 — the site can be seen and has been measured

## Phase 1: Setup

- [ ] T001 Amend constitution VII (2.5.0 → 2.6.0) in `.specify/memory/constitution.md`: a second runtime is allowed for read-only operational services and for advisory components the pipeline can run without; the claim pipeline, the X client and anything that posts stay in one TypeScript process. Record the owner decision as `docs/decisions/001-second-runtime.md` — **the directory does not exist yet**, so this creates the convention `CLAUDE.md` already cites (`docs/decisions/0NN-*.md`) — and update the version line in `CLAUDE.md`. **Blocks T008 and every Python task.**
- [ ] T002 [P] List the new dependencies with a one-line reason each in `plan.md` → Technical Context (fastapi, uvicorn, jinja2, psycopg3, locust, pytest) and get explicit approval before T008 (constitution VII: new dependencies need approval and a stated reason).
- [ ] T003 [P] Python toolchain skeleton: **one `pyproject.toml` at the repository root** (Python 3.12, ruff, pytest) with optional-dependency groups `status` (fastapi, uvicorn, jinja2, psycopg3), `load` (locust) — three directories, one project, so no group's dependencies are declared nowhere. The `verifier` group is **added by T028**, once the runtime is chosen against the measured memory headroom; declaring it now would pin a dependency to a decision that has not been made. Plus `.python-version`, and `__pycache__/`, `.venv/`, `*.pyc`, `load/results/`, `verifier/model/`, `verifier/eval/data/`, `.build-info.json` added to `.gitignore`.
- [ ] T004 [P] Add a Python job to `.github/workflows/test.yml`: `actions/setup-python@v5` with 3.12, `pip install -e '.[status,load]'`, then `ruff check .` and `pytest status load` from the repository root, so the load harness runs in CI. T028 adds the verifier group and its pytest path in the same commit that chooses the runtime. One workflow, two jobs — not a second pipeline (FR-021).

---

## Phase 2: Foundational (blocks US1; read by US3)

- [ ] T005 Migration `drizzle/0014_job_state.sql` + `src/db/schema.ts`: table `job_state` (job text primary key with a CHECK against the eight known job names, `last_started_at`, `last_finished_at`, `last_ok_at`, `last_outcome` text CHECK `ok|failed` (a lock skip is **not** an outcome — see T006), `last_locked_at` null, `last_error_tag` text null, `consecutive_failures` int not null default 0, `stale_after_seconds` int not null); RLS on, no policies; a down migration. Apply locally, then on Supabase.
- [ ] T006 `src/jobs/scheduler.ts`: `runJob` upserts `job_state` — `last_started_at` on entry, then `ok` or `failed` (with the error tag). A run skipped because the advisory lock was held (`withJobLock` already returns `{ran: false}`) touches **only `last_locked_at`** and nothing else: the lock is usually held by a run that is working normally — a manual `jobs:tick` next to the cron tick — so writing an outcome there would report a healthy job as broken. Failures still go to Sentry unchanged (FR-001, FR-020).
- [ ] T007 `src/jobs/scheduler.ts`: declare `stale_after_seconds` per job next to `SCHEDULES` — the rule is `interval × 2 + 60s`, floored at 120s, so a once-a-minute job is late after two minutes and a twice-daily job after a day and a bit. **The code is the single source of truth**: on startup, upsert all eight rows and overwrite `stale_after_seconds` every time, so changing a schedule can never leave a stale window behind in the database. A job that has never run is then visible as never-run rather than absent (FR-001, SC-002).
- [ ] T008 `deploy/deploy.sh`: after the rsync, write `/opt/vaticeno/.build-info.json` on the server — commit SHA, deploy timestamp, `node --version`. Build info only; installing the new systemd units belongs to the tasks that create them (T016, T032), because at this point they do not exist. No build info is inferred at runtime (FR-002).
- [ ] T009 A read-only Postgres role, created by a **documented `deploy/` step, never a committed migration**: roles are cluster-level and need a password, which must not reach git (AGENTS.md). `deploy/status-role.md` holds the `CREATE ROLE` + `GRANT SELECT` statements to run once by hand on Supabase; `DATABASE_URL_RO` goes in `.env.example` with an empty value and into the server's `.env` only. The status service never gets a writing credential (FR-003).
- [ ] T010 [P] Test `tests/integration/job-state.test.ts`: a successful run sets `last_ok_at` and clears the failure count; a throwing job records `failed` with its tag and increments the count; a run skipped because the lock was held sets `last_locked_at` only — `last_outcome`, `last_ok_at` and the failure count are all untouched, so a long run with a manual tick beside it still reads healthy; a seeded job that never ran reads as never-run.

**Checkpoint**: every job's state is in the database, the deploy records what it deployed, and a read-only role exists. No new runtime yet.

---

## Phase 3: US1 — the status page (P1) 🎯 MVP

**Goal**: one page that says whether it is running and where the project stands.

**Independent test**: stop one job, or point it at a dead database, and the page names what is broken — which job, and how long it has been stale.

- [ ] T011 [US1] `status/queries.py`: one function per block, each a single SQL statement against the read-only role — job state with computed staleness, claims by status, verdicts by outcome with `needs_human` and its oldest age, feed posts today by kind, spend today and over 30 days with the per-claim average against the $0.30 ceiling.
- [ ] T012 [US1] `status/build_info.py` and `status/progress.py`: read `.build-info.json` and `docs/progress.md`, both tolerating a missing file, and return the progress file's modification time alongside its content (FR-002, FR-007).
- [ ] T013 [US1] `status/app.py`: FastAPI with exactly two routes — `/` (HTML) and `/status.json` (the same numbers) — binding `127.0.0.1` only. Every query wrapped so a database failure renders a page saying so instead of a stack trace (FR-005, FR-006).
- [ ] T014 [US1] `status/templates/status.html` + `status/templates/style.css`: server-rendered Jinja2, no client JavaScript, one screen at 1280px with no scrolling, overall state in the first line — then build, the job table with STALE flags, claims, verdicts, feed, spend, and the progress block with its date last (SC-001).
- [ ] T015 [US1] `docs/progress.md`: the hand-edited stage / done / now / next file, seeded with the current state of the project.
- [ ] T016 [P] [US1] `deploy/vaticeno-status.service`: systemd unit running uvicorn on `127.0.0.1:3001` as the service user with `DATABASE_URL_RO`, `Restart=on-failure`, plus the line in `deploy/deploy.sh` that installs it. Never added to `deploy/Caddyfile` — the page is reached by SSH tunnel, like the claim pages (FR-004).
- [ ] T017 [US1] `status/tests/test_status.py`: three cases only — a healthy system renders every block; a job past its stale window renders STALE and the overall state is not "ok"; an unreachable database still renders a page. Fixtures are rows, not a live service.
- [ ] T018 [P] [US1] `README.md`: the status page in the Scripts table and the tunnel command (`ssh -L 3001:127.0.0.1:3001 …`) in the Deploy section, next to the existing claim-page tunnel.

**Checkpoint**: US1 ships. **Then use it for a week before starting Phase 4** — if it does not get opened, it was the wrong page, and that is worth knowing before two more services exist.

---

## Phase 4: US2 — the capacity baseline (P1)

**Goal**: replace every guessed number with a measured one, and find the limits before users do.

**Independent test**: a load run produces a capacity table that can be re-run after a change to see whether it regressed.

- [ ] T019 [US2] `load/guard.py`: refuse any target that is not localhost, and refuse to run when `ENABLE_X`, a real `X_*` token or a real Gemini key is present in the environment. Imported by every harness entry point — an external call during a load run is a bug, and this is what makes it one (FR-008, spec Edge Cases).
- [ ] T020 [US2] `load/locustfile.py`: user classes for `/c/<slug>` and `/u/<id>` against a local server with seeded claims, plus `/healthz`. Ramps until p95 degrades and records the rate at that point (FR-009).
- [ ] T021 [US2] `load/burst.py`: drive the mention and lock path at ten times the live rate with X, Gemini and the price feed stubbed, asserting exactly one reply per mention, no duplicate post and no mention lost (FR-010, SC-004). Mentions are **not** database rows: they arrive from `fetchNewMentions` and dedup state lives in a JSON file, so the harness feeds a stubbed X reader and points `statePath` at a temporary file. Record how `replied_tweet_ids` grows — it is read and rewritten on every poll, and it is what "no duplicate replies" actually rests on.
- [ ] T022 [US2] Measure the connection ceiling: raise concurrency past the postgres.js pool (`max: 5`, `prepare: false` — the Supabase pooler) and record whether the service queues, refuses cleanly or wedges, and how long it takes to recover (US2 scenario 3).
- [ ] T023 [US2] Measure peak RSS per process under load — the Node service with its jobs, the status service — against the box's memory, and state the headroom. This is the number that decides what Phase 5 can afford (SC-008, plan → Risks).
- [ ] T024 [US2] `specs/003-python-platform/capacity.md`: the table (SC-003). Each row carries what was measured, the number, the hardware and the date. Laptop and droplet recorded separately, because only the droplet answers "will the box hold".
- [ ] T025 [US2] Replace the UNRECONCILED labels this feature measured with the measurement and its date — `specs/002-content-feed/spec.md` SC-002 and `src/x/prices.ts` where the runs cover them. A documented number is still not a verified one (FR-011).
- [ ] T026 [P] [US2] `README.md`: how to run a load run locally (`docker compose up -d`, seed, locust, burst) in the Scripts table.

**Checkpoint**: the numbers exist, the droplet's headroom is known, and the UNRECONCILED labels this feature can answer are gone. **This gates T028's model choice.**

**🚀 Stage 1 deploys here** — two units on the box, the page reachable by tunnel, a capacity table with real numbers. Use it before starting Stage 3.

---

# Stage 2 — contract functionality

A separate feature with its own spec, plan and tasks. No task in this file belongs to it, and neither Stage 1
nor Stage 3 waits for it.

---

# Stage 3 — model teaching and what follows

## Phase 5: US3 — the local verifier (P2)

**Goal**: keep the paid model for the cases that need it, and prove the fast path cannot err on the cases it takes.

**Independent test**: zero wrongly auto-finalised claims on the held-out set, with the avoided-call share reported.

### Offline: build it and measure it

- [ ] T027 [US3] `verifier/eval/dataset.py`: assemble the held-out set from the seeded claims and the real verdicts already in the database — claim statement, each passed evidence item, the known outcome. Written to `verifier/eval/data/`, which is **gitignored (T003)**: it contains evidence quotes, i.e. fetched page content, and the fixtures rule commits cases and seeds but never fetched answers. Only the generator and the report are committed. Report the set's size honestly; if it is too small to trust a measurement, say so and stop (spec Assumptions).
- [ ] T028 [US3] `verifier/eval/baseline.py`: a stock entailment model, thresholded, reported at **two levels**. Model level: entailment and contradiction performance, latency, memory. **Fast-path level** — the one that matters: apply the full decision rule (per-item entailment → the recorded independence and gate results already stored on `evidences` → aggregate) and report how many claims could be auto-finalised and how many of those would be wrong. Raw NLI accuracy is secondary; the gate is the unit of safety. Search the threshold by one rule — the highest fast-path coverage at zero wrong auto-finalisations. Add the `verifier` dependency group and its pytest path (T003, T004) in this commit, now that the runtime is chosen against T023's headroom.
- [ ] T029 [US3] `verifier/train/finetune.py`: fine-tune a small encoder on public fact-verification data, offline, no live traffic and no post text stored (FR-019, INIT_SPEC §6.9). Deliverables are a **reproducible run**, not just a script: the training config and the exact command committed as `verifier/train/config.toml` and a line in the report, the dataset and its version named, the seed fixed, and `verifier/train/report.md` holding the training and validation curves. Weights land in `verifier/model/`, fetched by `verifier/model/fetch.sh` against a checksum pinned in the repo — never committed.
- [ ] T030 [US3] `verifier/eval/compare.py` → `verifier/eval/report.md`: both candidates on the same held-out set, each reported at both levels — model (entailment and contradiction performance, latency, memory) and fast path (coverage, wrongly auto-finalised claims, paid calls avoided) — and the chosen winner, selected on the fast-path numbers. The baseline winning is a valid result; so is "saves very little", which ends the feature here (FR-019, SC-005, SC-006).

**Checkpoint**: one report, two candidates, one decision, nothing wired into production. The feature may legitimately stop at this line.

### Shadow: run it, ignore it

- [ ] T031 [US3] Migration `drizzle/0016_verifier.sql` + `src/db/schema.ts`: table `verifier_shadow` (claim id, model name and version, the local answer, confidence, what the paid model concluded, created_at) — append-only and **separate from `resolutions`**, so a shadow answer can never be read as the decision that was taken (FR-016). Re-run T009's grant script for the new table and columns, or the status page's verifier block (T040) fails on a permission error. Plus `decided_by_version`, `verifier` and `verifier_confidence` nullable on `resolutions`, with the CHECK constraints updated (FR-015).
- [ ] T032 [US3] `verifier/serve/app.py`: one endpoint taking a claim statement and one evidence passage, returning entailment / contradiction / neutral with a confidence. No database, no credentials, binds `127.0.0.1:3002`. Plus `deploy/vaticeno-verifier.service` and its install line in `deploy/deploy.sh` (FR-020).
- [ ] T033 [US3] `src/resolve/verifier.ts`: the client — short timeout, structured output parsed with Zod, and a fall-through that returns "no opinion" on any error, timeout or malformed answer. A missing verifier is an outage of an optional component, never a verdict (FR-012, constitution III).
- [ ] T034 [US3] Wire shadow mode into `src/resolve/resolver.ts`: ask the verifier on every resolution, **ignore the answer**, and write both answers to `verifier_shadow`. Config `VERIFIER_URL` and `VERIFIER_MODE` (`off|shadow|live`, default `off`) in `src/config.ts` and `.env.example`.
- [ ] T035 [US3] Test `tests/integration/verifier-shadow.test.ts`: a shadow run leaves the `resolutions` row byte-identical to a run with the verifier absent, and writes exactly one shadow row. This is the test that makes "shadow cannot change a verdict" a fact rather than an intention.

**Checkpoint**: shadow rows accumulate, disagreements get read by hand, and no verdict has changed. By construction it could not have.

**🚀 Stage 3 deploys here, the first of two** — the verifier on the box in shadow mode, deciding nothing. A real deploy and a real gate, not a rehearsal.

### Live: the fast path, behind a switch

- [ ] T036 [US3] `src/resolve/fast-path.ts`: the gate. Finalises only when confidence is above the threshold **and** two items that 001's existing independence gate (`src/resolve/gates.ts`) counts as independent agree **and** every deterministic check passes **and** no numeric, date or entity conflict exists. Everything else escalates. Absence of evidence stays VOID, never MISS (FR-013, FR-014).
- [ ] T037 [US3] Test `src/resolve/fast-path.test.ts`: **exhaustive**, including the two-item aggregation itself — entail + entail → eligible; entail + neutral → escalate; entail + contradiction → escalate; contradiction + contradiction → eligible as a MISS only when every other gate permits it and the evidence `says` agrees. Plus: each condition failing in isolation escalates; two excerpts from one page count as one item; a confident answer with a date or number mismatch escalates anyway; no evidence yields VOID; a verifier error escalates. One more: the TypeScript gate and T028's evaluation harness agree on the same fixtures, so the offline numbers describe the code that ships. This gate can finalise a verdict, so it is tested like the other gates and the resolver.
- [ ] T038 [US3] `VERIFIER_MODE=live` in `src/resolve/resolver.ts`: the fast path finalises, records who actually decided and that decider's version, and escalates otherwise. Turning the switch off returns to today's behaviour with no migration and no deploy (FR-017, SC-009).
- [ ] T039 [US3] A verdict decided on the fast path can be **marked contradicted** during the existing human review (`src/cli/review-list.ts`, `src/cli/resolve-manual.ts`): one column, one CLI flag. The mark and the counter, not a new review process (FR-018).
- [ ] T040 [US3] `status/queries.py` + the template: a verifier block — fast-path count, escalations, shadow agreement rate, contradictions. A contradiction is shown as an incident, not as a metric among others (FR-018).
- [ ] T041 [US3] Measure and record the avoided-call share and the per-claim spend against the pre-feature baseline from `cost_events`, in `verifier/eval/report.md`. Whatever the figure is, it is what gets written down (SC-006, SC-007).
- [ ] T042 [US3] Re-run T023's memory measurement with **all three processes live** — the Node service with its jobs, the status service and the verifier — and update `capacity.md` with the new peak and headroom. T023 measured a box without the verifier on it, so SC-008 is not satisfied until this row exists; if the headroom is gone, the honest answer is a bigger box, not a smaller model (SC-008, spec US2 scenario 4).

**Checkpoint**: the fast path has been switched on, switched off, and switched on again, with SC-005 holding on the held-out set.

**🚀 Stage 3 deploys here, the second of two** — the switch on, with the page showing what the fast path is doing.

---

## Phase 6: Polish

- [ ] T043 [P] `README.md`: the two new services in the Layout and Deploy sections, and the Done/Next table updated for what actually shipped.
- [ ] T044 [P] Mark completed tasks `[x]` here with a one-line result, and sync `specs/003-python-platform/plan.md` wherever implementation diverged from it (AGENTS.md: specs and code do not diverge).
- [ ] T045 Re-run `npm test`, `npm run test:integration`, `npm run typecheck`, `ruff check` and `pytest` together, and confirm coverage is still reported and never enforced.

---

## Dependencies

```
STAGE 1
  Phase 1 (T001 constitution, T002 deps approval) ─ blocks all Python work
          ↓
  Phase 2 (T005–T010 job state, build info, read-only role)
          ↓
  US1 (T011–T018) ── ships, then a week of use
          ↓
  US2 (T019–T026) ── T023's memory number gates T028
          ↓
       🚀 deploy

STAGE 2  contract functionality — separate feature, nothing here waits for it

STAGE 3
  US3 offline (T027–T030) ── may end the feature here
          ↓
  US3 shadow (T031–T035) ── 🚀 deploy; cannot change a verdict
          ↓
  US3 live (T036–T042) ── 🚀 deploy; switch off by default
```

US1 and US2 are both P1 and both independently shippable; US2 needs nothing from US1 except Phase 2's job
state. **US3's offline evaluation (T027–T030) can run independently, on a laptop** — what T023's VPS memory
measurement gates is *deploying* the verifier, not evaluating it.

## Parallel opportunities

- Phase 1: T002, T003, T004 together.
- Phase 2: T010 alongside T008 and T009.
- US1: T016 (the systemd unit) and T018 (the README) together once T013 exists.
- US2: T026 alongside the measuring tasks.
- US3: T029 (training) runs while T028's baseline numbers are being read; T043 alongside T042.

## Implementation strategy

**MVP is US1 alone.** It is useful the day it ships, it needs no new ideas, and it is what makes the rest
measurable. US2 turns the specs' guesses into numbers. US3 is the only part that might not ship at all —
and Phase 5's first checkpoint is deliberately placed so that finding out costs four tasks, not forty.
