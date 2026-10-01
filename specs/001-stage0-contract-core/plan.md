# Implementation Plan: Stage 0 — Contract Core (offline)

**Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-stage0-contract-core/spec.md`

## Summary

Build the offline core on six tables (claims, positions, evidences, resolutions, cost_events, sources). A prediction
text becomes a structured contract (any topic): the contract proposal uses one model call plus one
retry, and deterministic checks decide whether it can be recorded; the statement is rendered from
the contract, never model-authored. Unclear predictions get a checked NEEDS INFO reply (case A).
After the deadline evidence is gathered — for prices, Coinbase daily candles compared in code (the
feed alone); otherwise web pages our code fetched and fingerprinted, read by a model — and every item passes code gates
(trusted, quote found, in window, final, independent). One resolution per claim: only the highest
trust level present decides (rated per page by the judge, capped in code: primary only on the
contract's own source domain; no fixed site list); one primary item, or two established items
agreeing, is final; sites that agreed with 5+ final verdicts are searched first;
disagreement within that level goes to an arbiter model, which decides with notes or flags the
claim for human review (CLI now, admin panel later). Proven by a 100-fixture corpus, 60 crypto seeds and a categorised
open-topic seed set, all replayable at zero cost. Before lock, amends and tweet edits replace the
contract with a new `[AMENDED]` reply (an edit that fails the checks or exceeds the limit expires
the claim); after lock nothing changes. No X calls (edits simulated).

## Technical Context

**Language/Version**: Node.js 22, TypeScript (strict)

**Primary Dependencies**: Zod (existing), Fastify 5, Drizzle ORM + drizzle-kit, postgres.js,
node-cron, @google/genai, @sentry/node — new ones need owner approval (see research.md)

**Storage**: PostgreSQL — Supabase (Frankfurt, DB only, 6 tables). Backend connects as the owner
role via the session pooler; RLS on with no policies blocks Supabase's public API; browsers reach
only Fastify. Local Postgres 16 in Docker for dev/test

**Testing**: node:test via tsx (unit); integration tests against local Postgres; corpus and seed
CLIs as regression suites in replay mode (recordings local only, research R5; CI runs the crypto
seeds, which need none)

**Target Platform**: Linux (DigitalOcean droplet, 1 GB, systemd, Caddy for HTTPS)

**Observability**: JSON logs via `src/log.ts` → journald on the droplet and Sentry Logs off it;
Sentry for errors, alerts (needs_human, budget, failing jobs) and cron monitors; external uptime
check on `/healthz` (research R11)

**Project Type**: single backend service + CLI (server-rendered pages, no frontend app)

**Performance Goals**: trivial volume (~300 claims/month); pages render < 300 ms; resolver run
completes within its hourly slot

**Constraints**: ≤ 1 GB RAM; no X calls in Stage 0; no post text stored or logged; ≤ $0.30 model +
search cost per claim; Coinbase candles ≤ 300 per request (≈ 13 requests for a 10-year window)

**Scale/Scope**: 1 operator; 100 fixtures; 60 crypto seeds; ≥ 60 open-topic seeds

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How the design complies | Status |
|---|---|---|
| I. Lock is immutable | DB triggers freeze contract/deadline once `lock_at` is set and enforce the transition table (DB is the authority); lock = last reply + 15 min; tweet re-read at lock, an edit is re-checked like an amend (`[AMENDED]` reply, or expired if it fails; the old contract is never locked), after lock nothing changes | ✅ |
| II. Checkable by construction | ContractSchema requires criterion, deadline, structured source (incl. `absence_is_meaningful`), negative condition; statement rendered; evidence from several sources, each through code gates; models judge only fetched, hashed snapshots; one resolution per claim (agree / arbiter / human flag); proof and gates stored and shown | ✅ |
| III. Outage is never a verdict | any failed step (feed, search, fetch, model, schema) produces no evidence; claim stays `resolving` for the next run | ✅ |
| IV. Speak only when spoken to | Stage 0 posts nothing; reply templates fixed; one reply per interaction (replies produced and checked by the CLI) | ✅ (n/a live) |
| V. IDs, not text | only IDs + our contract stored; fixture texts stay in fixture files; logs carry lengths, not text | ✅ |
| VI. Platform policy gates live behavior | no X calls; model-written replies only produced, never posted | ✅ |
| VII. Boring by design | 6 tables; one process; jobs are plain services called by CLI and cron; no admin web surface; no Redis/broker/frontend framework; Zod on every boundary (env, model output, Coinbase, fetched pages, HTTP); CHECK on every enum; 6 new deps listed for approval | ✅ pending dep approval |

Post-design re-check (after Phase 1): unchanged — ✅. No violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-stage0-contract-core/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R11 decisions
├── data-model.md        # tables, ContractSchema, triggers, lifecycle
├── quickstart.md
├── contracts/
│   ├── cli.md           # operator commands, fixture/seed formats
│   ├── http.md          # public pages (no admin surface)
│   ├── llm-schemas.md   # proposal + judge output shapes
│   └── reply-templates.md
├── checklists/requirements.md
└── tasks.md             # task list and status
```

### Source Code (repository root)

```text
src/
├── config.ts, log.ts               # existing — extended (DB, model env; log → stdout + Sentry Logs, R11)
├── observe.ts                      # Sentry init, scrubber, cron monitors, alert(), flush (R11)
├── commands/, ingest/, x/, poc/    # existing POC — NOT touched by Stage 0 tasks
├── db/
│   ├── schema.ts                   # Drizzle: claims, positions, evidences, resolutions, cost_events
│   ├── client.ts                   # createDb (tests, scripts), getDb/getSql (entrypoints only)
│   ├── migrate.ts                  # applies drizzle/ migrations
│   ├── scratch.ts                  # throwaway migrated database (tests, seed runs)
│   └── costs.ts                    # recordCosts (db or transaction)
├── contract/
│   ├── schema.ts                   # ContractSchema (Zod)
│   ├── render.ts                   # statement from fields — the only statement source
│   ├── proposal.ts                 # ProposalSchema (what the model proposes)
│   ├── checks.ts                   # FR-003 checks, pure
│   └── slug.ts
├── llm/
│   ├── client.ts                   # Gemini wrapper: live|record|replay, cost events
│   ├── replay.ts                   # replay store (R5); refuses text/quote fields
│   ├── prices.ts                   # model + search prices (UNRECONCILED)
│   ├── instructions/               # normalize.v2, search.v2, judge.v2, arbitrate.v1 (older versions kept)
│   ├── instructions.ts             # loads versioned prompts
│   ├── normalize.ts                # proposal + one retry
│   └── judges.ts                   # grounded search → URLs; judge (one page); arbiter (contradictions)
├── lifecycle/
│   ├── transitions.ts              # early refusal; DB trigger is the authority
│   ├── lock.ts                     # lock_at = last reply + 15 min; re-read at lock, edit → re-checked amend or expired
│   ├── expire.ts                   # needs_info older than 24 h → expired
│   ├── source-reader.ts            # SourceReader port: fixture now, X in Stage 1
│   └── claims.ts                   # submit, amend (services, take deps + `now`)
├── replies/
│   ├── templates.ts                # fixed frames, X-weighted length check
│   └── needs-info.ts               # checked examples (FR-008)
├── resolve/
│   ├── price-evidence.ts           # Coinbase candles over (lock_at, deadline] → evidence
│   ├── web-evidence.ts             # search → fetch → judge per snapshot → evidence
│   ├── fetch.ts                    # snapshot, sha256, retrieved_at
│   ├── trust.ts                    # capTrust(rated, url, contract): primary only on the locator domain — pure
│   ├── sources.ts                  # known sources (agreed ≥ 5) + per-claim upsert at final verdict
│   ├── gates.ts                    # trusted, quote_found, in_window, final, independent — pure
│   ├── similarity.ts               # quote check, simhash near-duplicates — pure
│   ├── decide.ts                   # rule table → final | needs_arbiter | needs_human | wait — pure
│   ├── resolver.ts                 # due claims → evidence → rule table → resolution (service, takes `now`)
│   └── manual.ts                   # review list + human decision (the only operator write path)
├── feeds/coinbase.ts               # Zod-validated candles client
├── jobs/
│   ├── scheduler.ts                # node-cron: only calls the service functions above
│   └── lock.ts                     # withJobLock: Postgres advisory lock per job
├── web/
│   ├── server.ts                   # Fastify (public, read-only)
│   ├── html.ts                     # escaping helper
│   └── claim-page.ts, author-page.ts
└── cli/                            # corpus, seeds:*, claim:*, jobs:tick, resolve:manual
drizzle/                            # SQL migrations (hand-edited triggers + RLS)
fixtures/
├── corpus/*.jsonl                  # 100 fixtures by group
├── seeds/crypto/*.json             # 60 claims with frozen Coinbase candles
├── seeds/open/*.json               # categorised per SC-003
└── replay/                         # recorded model, search, fetch, feed responses — gitignored, local only
tests/integration/                  # real Postgres: triggers, transitions, uniqueness, services
deploy/                             # systemd units, backup.sh + nightly timer, journald cap, Caddyfile
```

**Structure Decision**: single project extending the existing `src/`; unit tests colocated as
`*.test.ts`, DB-backed tests in `tests/integration/`. The core runs as CLI → service → DB; cron and
the web server are thin callers of the same services. Phase 9 wires X: the service runs the web server,
whose scheduler polls mentions (`src/bot/`, `ENABLE_X`); the POC poller (`src/poc/`) is no longer run.
Two extra commands live in `src/bot/extras.ts`: `selfpromo` (fixed motto + AI joke, `joke.v1`) and `quote`
(AI + Google Search finds a real quote, `quote.v1`; posted only if our fetch of its page contains it and names the author; replies never tag anyone). Nothing
is stored; their costs are recorded without a claim.

## Architecture

A light **functional core, imperative shell** (a cousin of Clean / hexagonal architecture, without
its ceremony):

- **Core — pure**: `contract/`, `resolve/{trust,gates,decide}`, `lifecycle/transitions`. No DB,
  network, clock or logging; takes values, returns values. The exhaustive tests live here.
- **Services**: `lifecycle/*`, `resolve/{resolver,web-evidence,price-evidence}`. Orchestrate and
  do I/O; receive their dependencies as arguments (`{ db, llm, reader, now }`), never call
  `getDb()` or `new Date()` themselves.
- **Adapters**: `db/`, `llm/`, `feeds/`, `resolve/fetch`, `log`, `observe`.
- **Entrypoints — thin**: `cli/`, `jobs/scheduler`, `web/` routes. Parse input, build the deps,
  call one service, print or render.

Imports only point inward (entrypoints → services → core/adapters; the core imports no adapter).
No repository interfaces or DI container: Postgres is fixed and tests run against a real one. The
one port is `SourceReader` (fixture now, X in Stage 1).

## Complexity Tracking

No constitution violations to justify.

## Open items carried to tasks

- Owner approval for the 6 new dependencies (research.md).
- Droplet resize to 1 GB and Supabase project creation are manual owner steps (quickstart).
- Daily close = Coinbase candle starting 00:00 UTC (verified live 2026-09-29); seed building
  cross-checks a few days against a second source.
