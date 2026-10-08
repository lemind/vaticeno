# Implementation Plan: Operations, capacity and cost

**Branch**: `003-planing` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

## Summary

Three deliverables, strictly in order. **One**: every job records its state, the deploy records what it
deployed, and a small Python service renders both as one page. **Two**: a Python load harness turns the
UNRECONCILED capacity numbers into measured ones and finds the limits before users do. **Three**: a locally
evaluated entailment model — a pretrained baseline first, then a small fine-tuned one, compared on the same
held-out set — sits in front of the paid model and finalises only the cases it can prove are easy, in shadow
first and behind a switch second.

Each stands alone and ships on its own.

## Technical Context

Stack and layout are 001's ([plan.md](../001-stage0-contract-core/plan.md#architecture)) and unchanged by
this feature. Two facts from it matter here: the database handle is postgres.js with `max: 5` and
`prepare: false` (the Supabase pooler rejects prepared statements), which is the connection ceiling the capacity
baseline measures; and the scheduler runs **eight** jobs in the one Node process under advisory locks.

**New**: Python 3.12 · FastAPI + Jinja2 + uvicorn · psycopg3 on a read-only role · Locust · pytest · a local
entailment model whose runtime is chosen in Stage 3, against the memory headroom actually measured. Each needs explicit approval with a stated reason
(constitution VII). Nothing deliberately absent is added — no Redis, no broker, no frontend framework, no
auth, the last because the page is reachable only through an SSH tunnel.

## Constitution Check

- **VII — blocking.** Proposed amendment: *"A second runtime is allowed for read-only operational services
  and for advisory components the pipeline can run without. The claim pipeline, the X client and anything
  that posts stay in one TypeScript process."* Owner decision required before any Python ships, as the own-feed work
  did for VI.
- **II.** The verifier is a gate in front of the arbiter, never an evidence source, and it reuses 001's
  gates rather than redefining any of them.
- **III.** A verifier that is missing, slow or failing is an outage of an optional component: fall through to
  the paid model. It never decides by failing and never causes a void.

## Boundaries

```
                 Postgres (the only shared state)
                    ▲            ▲
   ┌────────────────┴──┐   ┌─────┴───────┐   ┌───────────────────┐
   │ Node service      │   │ status      │   │ verifier          │
   │ pages, 8 jobs,    │   │ (Python)    │   │ (Python)          │
   │ X, resolver       │   │ read-only   │   │ one question,     │
   │ :3000             │   │ role, :3001 │   │ no DB, :3002      │
   └───────┬───────────┘   └─────────────┘   └───────▲───────────┘
           └──── one localhost call, timeout, ───────┘
                 falls through on any failure
```

No shared files, no shared memory, no in-process calls. The status service never writes. The verifier never
touches the database — the resolver passes it the claim and the evidence it already has.

## Project Structure

```
status/      the status service: routes, queries, Jinja templates, tests
load/        locustfile for the pages, a synthetic mention burst for the job path
verifier/    eval (offline), train (offline), serve (one endpoint), model weights (never in git)
deploy/      two more systemd units; deploy.sh writes build info and installs them
src/jobs/scheduler.ts      runJob writes the job's state row — the one touch on the TS side
src/resolve/verifier.ts    the client: timeout, fall-through, the fast-path gate
drizzle/00NN_*.sql         job_state, verifier columns, the shadow table
docs/progress.md           hand-edited; the page shows its modification time
specs/003-python-platform/capacity.md   the measured table (capacity-baseline output)
```

Exact filenames land in tasks.md.

## Database changes

**`job_state`** — one row per job, upserted by `runJob`: job name (CHECK against the known names),
`last_started_at`, `last_finished_at`, `last_ok_at`, `last_outcome` (`ok` or `failed`), `last_error_tag`,
`last_locked_at`, `consecutive_failures`, and a per-job `stale_after_seconds` so "late" is a property of the
job rather than a guess in the page.

A run skipped because the advisory lock was held writes `last_locked_at` and nothing else. The lock is
normally held by a run that is working — a manual `jobs:tick` beside the cron tick — so treating a skip as an
outcome would report a healthy job as broken.

Upsert rather than an append-only log, deliberately. Two jobs run every minute; a row per run is about a
million rows a year and a retention sweep to own. One row per job answers everything the page asks, and
failures already go to Sentry with their context. If the capacity baseline shows per-run durations are needed, an
append-only table for **slow or failed runs only** gets added then.

**`resolutions`** gains `decided_by_version` and, when the fast path decided, the verifier's name and
confidence. These say **who actually decided** — a verdict the paid model reached says so even when the local
model also had an opinion.

**`verifier_shadow`** — separate, append-only: claim, model version, the local answer and confidence, and
what the paid model concluded for the same case. Shadow results are not the decision and must not be
readable as one, which is why they do not share a table with it. Dropping this table removes the experiment
and changes no verdict.

## Deploy stages

Three deploys, in this order. Each one reaches the server and gets used before the next starts, and each is
worth having on its own if the ones after it never happen.

| Stage | What it is | What reaches the server | Where it is specified |
|---|---|---|---|
| **1** | The site can be seen and has been measured | job state, build info, the status service, the capacity table | this feature, [tasks.md](tasks.md) Phases 1–4 |
| **2** | Contract functionality, on a testnet | the contract and its settling worker | **a separate feature**, specified on its own |
| **3** | Model teaching and what follows from it | the verifier: offline, then shadow, then the fast path | this feature, [tasks.md](tasks.md) Phase 5 |

Phase numbers belong to `tasks.md` alone, where they follow the task template (setup, foundational, then one
per user story). The steps below are named, not numbered, so one "Phase 2" never means two different things.

**Stage 2 is not planned in this document.** It is its own feature with its own spec, plan and tasks, and
nothing in Stage 1 or Stage 3 depends on it. The one place the stages meet is the status page: Stage 1 builds
it as one query function per block (`status/queries.py`), so Stage 2 adds its rows by adding a function and a
template partial, not by rewriting the page.

Stage 3 comes last on purpose. It is the only stage that can legitimately end with "not worth shipping", and
it is the only one whose cost depends on a measurement — the memory headroom Stage 1 produces.

---

## Stage 1 — the site can be seen and has been measured

### Step: job state and build info (TypeScript, small)

One migration, one touch in `runJob` (`src/jobs/scheduler.ts`) where the advisory lock and the error capture
already are, and `deploy.sh` writing `.build-info.json` on the server after the rsync. Existing `/healthz`
unchanged.

**Gate**: all eight jobs fill the table, including skipped-because-locked runs; integration tests cover a
failing job and a job that never ran.

### Step: the status service (Python, the first new runtime)

Read-only database role, FastAPI + Jinja2, uvicorn on `127.0.0.1:3001`, its own systemd unit, reached over an
SSH tunnel exactly like the claim pages. Renders when the database is down. `/status.json` carries the same
numbers. The progress block reads `docs/progress.md` and prints its modification time.

**Gate**: the page is correct with a healthy system, with a dead job, and with no database.

*Not a gate, but the point of the phase*: use it for a week before starting the capacity baseline. If it does not get
opened, it was the wrong page, and that is worth knowing before two more services exist.

### Step: the capacity baseline (Python)

Locust against a local instance for the pages; a synthetic mention burst against the job path with X, Gemini
and the price feed stubbed, and a guard that refuses any non-local base URL. Produces `capacity.md`: request
rate at a stated p95, where the five-connection pool saturates, peak memory per process, behaviour past each
limit — each row dated and tied to its hardware. Laptop and droplet recorded separately; only the second
answers "will the box hold". Then the UNRECONCILED labels elsewhere get replaced.

**Gate**: the numbers exist and the droplet's headroom is known. This gates which model Stage 3 can afford.

**Stage 1 deploys here**: two systemd units on the box (the service as today, plus the status service), a page
reachable by tunnel, and a capacity table with real numbers in it. Use it before starting anything else.

---

## Stage 2 — contract functionality

A separate feature, not planned here. It reaches the server as its own process and settles on a testnet only.
Stage 1 does not wait for it and Stage 3 does not depend on it.

---

## Stage 3 — model teaching and what follows

### Step: the verifier, offline only (Python)

Two candidates, one held-out set, one comparison.

1. A stock entailment model, thresholded. The threshold is set by one rule: the highest coverage at zero
   wrongly auto-finalised claims.
2. A small encoder fine-tuned on public fact-verification data, thresholded the same way.
3. Both measured on the same set: precision, coverage at zero wrong auto-finalisations, inference latency,
   memory. The capacity baseline's memory numbers decide what is affordable at all.
4. The winner is what the shadow deploy serves. The baseline winning is a real possibility and a result worth having.

Nothing is wired into production in this step.

**Gate**: one report holding both candidates' numbers, the chosen threshold, and the honest size of the
evaluation set. A finding of "saves very little" ends the feature here, and that is a successful
outcome: the measurement is the deliverable.

### Step: shadow

`verifier/serve` on `127.0.0.1:3002`, its own unit. The resolver asks it on every resolution and **ignores
the answer**: the paid model decides as today, and both answers land in `verifier_shadow`. The disagreements
get read by hand.

**Gate**: enough shadow cases to see the disagreement pattern, and no disagreement that the threshold cannot
explain. This phase cannot change a verdict, by construction.

### Step: the fast path on, behind a switch

Off by default; turning it off returns to today's behaviour with no deploy. Fast-path counts, escalations and
the shadow agreement rate appear on the status page, and a fast-path verdict marked contradicted in review is
an incident, not a metric.

**Gate**: SC-005 holds on the held-out set, the shadow run agrees, and the switch has been turned off and on
once to prove it works.

**Stage 3 deploys twice**: once with the verifier in shadow, deciding nothing, and once with the switch on.
The shadow deploy is a real deploy and a real stage gate, not a dry run.

## Risks

- **1 GB of RAM may not fit local inference** alongside Node. The capacity baseline measures it before a
  model is chosen, and it is measured again once the verifier is actually running; the honest outcome may be
  a bigger box.
- **Shadow must not alter a verdict.** Separate table, ignored answer, and a test that asserts a shadow run
  leaves resolutions byte-identical.
- **The savings may be small, and the trained model may lose to the baseline.** Both are results, not
  failures; the offline step is allowed to end the feature and the comparison is what gets written down.
- **A load run that reaches the network spends money.** The guard is in the harness and asserted by a test:
  any external call in a load run is a bug.
- **Two runtimes raise operational complexity.** One deploy script, one CI workflow; the Python side gets
  steps, not a pipeline of its own. No Dockerfiles until something needs them — a host move, or a third
  runtime. Writing one to sit unused is work that rots.
- **The status page exposes operations.** Localhost only, never behind Caddy, no admin action of any kind.
  Sharing it later is a new decision with authentication attached.

## Out of scope

Uptime monitoring from outside the box, a public status page, authentication, alerting beyond the existing
Sentry setup, any change to how claims are recorded, locked, judged or replied to, and any new X behaviour.
