# Implementation Plan: Visibility, settlement and cost

**Branch**: `003-planing` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

## Summary

Make the service visible, measure it, then make it cheaper. A read-only Python service renders job health,
build info and the project's own progress on one private page; a Python load harness replaces the specs'
estimated capacity numbers with measured ones; a local entailment model finalises only the resolutions it can
prove are easy, keeping the paid model for everything else.

## Technical Context

**Language/Version**: TypeScript on Node 22 (unchanged) · Python 3.12 (new) · Solidity for the escrow contract

**Primary Dependencies**: existing — Fastify, Drizzle, postgres.js, Zod, node-cron, Gemini, Sentry. New —
fastapi, uvicorn, jinja2, psycopg3 (status service), locust (load), pytest. The verifier's model runtime is
chosen in Stage 3, against the memory headroom Stage 1 measures. Stage 2 adds a contract toolchain and web3.py
for the settlement worker. Each needs owner approval with a stated reason (constitution VII).

**Storage**: PostgreSQL (Supabase) — see [data-model.md](data-model.md). No new store.

**Testing**: existing node test runner · pytest for the Python side, in the same CI workflow

**Target Platform**: one small Linux VPS, systemd units behind Caddy, one instance only · an EVM testnet for Stage 2

**Project Type**: one service plus three side processes — two read-only or advisory, one holding a signing key and nothing else

**Performance Goals**: none asserted — producing them is the point of Stage 1 ([capacity.md](capacity.md))

**Constraints**: the database pool is `max: 5` with `prepare: false` (the Supabase pooler rejects prepared
statements), which is the ceiling the load runs probe. Memory is the binding constraint on the verifier, and
is measured before a model is chosen and again once it runs.

**Scale/Scope**: single-owner operations page; eight scheduled jobs; the existing claim volume

## Constitution Check

- **VII (Boring by Design) — blocking.** A second runtime needs an amendment and an owner decision before any
  Python ships. See Complexity Tracking.
- **II (Checkable by Construction).** The verifier is a gate in front of the arbiter, never an evidence
  source, and reuses 001's gates rather than redefining them.
- **III (An Outage Is Never a Verdict).** A verifier that is missing, slow or failing falls through to the
  paid model. It never decides by failing and never causes a void.
- **V (IDs, Not Text).** Evaluation data is assembled from evidence already stored and is never committed.

## Project Structure

### Documentation (this feature)

```text
specs/003-python-platform/
├── plan.md          # this file
├── spec.md          # what and why
├── data-model.md    # the two new tables and the resolutions columns
├── tasks.md         # the work
└── capacity.md      # measured numbers (Stage 1 output)
```

### Source Code (repository root)

```text
status/      FastAPI + Jinja2, read-only role, localhost:3001
load/         locust for the pages, a burst harness for the job path
verifier/    eval and train (offline), serve (localhost:3002), weights never in git
contracts/   the escrow contract and its tests
settle/      the settlement worker: reads the outbox, signs, sends — and does nothing else
src/jobs/scheduler.ts      runJob writes job state — the one touch on the TypeScript side
src/resolve/               the verifier client and the fast-path gate
deploy/                    two more systemd units; the deploy writes build info
docs/progress.md           hand-edited, rendered with its own modification time
```

The three processes share no mutable runtime state, no memory and no in-process calls. Each integrates one
way only: the status service reads the database through a read-only role (plus two files the deploy and the
owner write — build info and the progress note — and it writes nothing); the settlement worker reads and
marks the outbox table; the verifier holds no database connection at all and is reached by one call on
localhost that Node treats as optional (FR-012a).

## Deploy stages

| Stage | What reaches the server | Where |
|---|---|---|
| **1** | job state, build info, the status service, the capacity table | [tasks.md](tasks.md) Phases 1–4 |
| **2** | the escrow contract, its settlement worker, and optional wallet links, testnet only | [tasks.md](tasks.md) Phase 5 |
| **3** | the verifier — shadow first, then behind a switch | [tasks.md](tasks.md) Phase 6 |

No stage waits for another. They meet in two places: the status page, which is one query function per block so
a later stage adds rows without a rewrite, and the rule that a verdict decided by the local verifier alone
never settles a stake. Stage 3 is last because it is the only one that may legitimately end in "not worth
shipping", and the only one whose cost depends on a measurement Stage 1 produces. Stage 2 stays on a testnet:
no real value and no fee until the contract has been reviewed by someone else.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| A second runtime and two more processes (VII) | The service layer is Python by owner decision 2026-10-08; the verifier must hold a model in memory without it living in the process that handles untrusted text | Doing it in TypeScript keeps one runtime but puts model weights and inference in the same process as the X client and the claim pipeline, and gives up the owner's stated reason for the choice |
| A local model in the resolution path (II, III) | Model calls are the largest variable cost and most decide easy cases | Raising the per-claim budget caps the cost instead of lowering it; dropping evidence checks would lower it by weakening the product |

| A process holding a signing key (VII) | Settlement must be able to move funds; the process that handles untrusted text from strangers must not hold the key that can | Signing inside the Node service keeps one runtime but puts a funds-moving key in the process that parses posts from the public |

VII amended 2026-10-09 (2.6.0 → 2.7.0, `docs/decisions/001-second-runtime.md`): a second runtime is allowed
for read-only operational services, for advisory components the pipeline can run without, and for a
settlement worker holding a signing key and nothing else; the claim pipeline, the X client and anything that
posts stay in one TypeScript process; the integration is a database table or one optional bounded call, and
database access is never signing authority.

## Out of scope

Uptime monitoring from outside the box, a public status page, authentication, alerting beyond Sentry, any
change to how claims are recorded, locked, judged or replied to, and any new X behaviour.
