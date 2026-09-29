# Implementation Plan: Stage 0 — Contract Core (offline)

**Branch**: `001-stage0-contract-core` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-stage0-contract-core/spec.md`

## Summary

Build the offline core on five tables (claims, positions, evidences, resolutions, cost_events). A prediction
text becomes a structured contract (any topic): the contract proposal uses one model call plus one
retry, and deterministic checks decide whether it can be recorded; the statement is rendered from
the contract, never model-authored. Unclear predictions get a checked NEEDS INFO reply (case A).
After the deadline evidence is gathered — for prices, Coinbase daily candles compared in code (the
feed alone); otherwise web pages our code fetched and fingerprinted, read by a model — and every item passes code gates
(trusted, quote found, in window, final, independent). One resolution per claim: passed evidence
agreeing is final; contradictions go to an arbiter model, which decides with notes or flags the
claim for human review (CLI now, admin panel later). Proven by a 100-fixture corpus, 60 crypto seeds and a categorised
open-topic seed set, all replayable at zero cost. Before lock, amends and tweet edits replace the
contract with a new `[AMENDED]` reply; after lock nothing changes. No X calls (edits simulated).

## Technical Context

**Language/Version**: Node.js 22, TypeScript (strict)

**Primary Dependencies**: Zod (existing), Fastify 5, Drizzle ORM + drizzle-kit, postgres.js,
node-cron, @google/genai, @sentry/node — new ones need owner approval (see research.md)

**Storage**: PostgreSQL — Supabase (Frankfurt, DB only, 5 tables). Backend connects as the owner
role via the session pooler; RLS on with no policies blocks Supabase's public API; browsers reach
only Fastify. Local Postgres 16 in Docker for dev/test

**Testing**: node:test via tsx (unit); integration tests against local Postgres; corpus and seed
CLIs as regression suites in replay mode

**Target Platform**: Linux (DigitalOcean droplet, 1 GB, systemd, Caddy for HTTPS)

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
| I. Lock is immutable | DB triggers freeze contract/deadline once `lock_at` is set and enforce the transition table (DB is the authority); lock = last reply + 15 min; tweet re-read at lock, an edit is handled as an amend (`[AMENDED]` reply), after lock nothing changes | ✅ |
| II. Checkable by construction | ContractSchema requires criterion, deadline, structured source (incl. `absence_is_meaningful`), negative condition; statement rendered; evidence from several sources, each through code gates; models judge only fetched, hashed snapshots; one resolution per claim (agree / arbiter / human flag); proof and gates stored and shown | ✅ |
| III. Outage is never a verdict | any failed step (feed, search, fetch, model, schema) produces no evidence; claim stays `resolving` for the next run | ✅ |
| IV. Speak only when spoken to | Stage 0 posts nothing; reply templates fixed; one reply per interaction (replies produced and checked by the CLI) | ✅ (n/a live) |
| V. IDs, not text | only IDs + our contract stored; fixture texts stay in fixture files; logs carry lengths, not text | ✅ |
| VI. Platform policy gates live behavior | no X calls; model-written replies only produced, never posted | ✅ |
| VII. Boring by design | 5 tables; one process; jobs are plain services called by CLI and cron; no admin web surface; no Redis/broker/frontend framework; Zod on every boundary (env, model output, Coinbase, fetched pages, HTTP); CHECK on every enum; 6 new deps listed for approval | ✅ pending dep approval |

Post-design re-check (after Phase 1): unchanged — ✅. No violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-stage0-contract-core/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R10 decisions
├── data-model.md        # tables, ContractSchema, triggers, lifecycle
├── quickstart.md
├── contracts/
│   ├── cli.md           # operator commands, fixture/seed formats
│   ├── http.md          # public pages (no admin surface)
│   ├── llm-schemas.md   # proposal + judge output shapes
│   └── reply-templates.md
├── checklists/requirements.md
└── tasks.md             # next: /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── config.ts, log.ts               # existing — extended (DB, model env)
├── ../config/source-policy.json    # issuer aliases + trusted sites per kind (adds to the locator rule)
├── commands/, ingest/, x/, poc/    # existing POC — NOT touched by Stage 0 tasks
├── db/
│   ├── schema.ts                   # Drizzle: claims, positions, evidences, resolutions, cost_events
│   └── client.ts
├── contract/
│   ├── schema.ts                   # ContractSchema (Zod)
│   ├── render.ts                   # statement from fields — the only statement source
│   ├── checks.ts                   # FR-003 checks, pure
│   └── slug.ts
├── llm/
│   ├── client.ts                   # Gemini wrapper: live|record|replay, cost events
│   ├── replay.ts                   # replay store (R5)
│   ├── instructions/               # normalize.v1, search.v1, judge.v1, arbitrate.v1
│   ├── normalize.ts                # proposal + one retry
│   ├── search.ts                   # grounded search → candidate URLs
│   ├── judge.ts                    # no-tools judge over fetched snapshots
│   └── arbitrate.ts                # decides between contradicting evidence, or flags for human
├── lifecycle/
│   ├── transitions.ts              # early refusal; DB trigger is the authority
│   ├── lock.ts                     # lock_at = last reply + 15 min; re-read at lock, edit → amend
│   └── claims.ts                   # submit, amend, lock, expire (services, take `now`)
├── replies/
│   ├── templates.ts
│   └── needs-info.ts               # example generation + validation (FR-008)
├── resolve/
│   ├── price-evidence.ts           # Coinbase candles over (lock_at, deadline] → evidence
│   ├── web-evidence.ts             # search → fetch → judge per snapshot → evidence
│   ├── fetch.ts                    # snapshot, sha256, retrieved_at
│   ├── trust.ts                    # trustLevel(url, contract, policy): locator domain = official — pure
│   ├── gates.ts                    # trusted, quote_found, in_window, final, independent — pure
│   └── resolver.ts                 # passed evidence → agree | arbiter | needs_human (service, takes `now`)
├── feeds/coinbase.ts               # Zod-validated candles client
├── jobs/scheduler.ts               # node-cron: only calls the service functions above
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
└── replay/                         # recorded model, search, fetch and feed responses
tests/integration/                  # triggers, uniqueness, transitions against Postgres
```

**Structure Decision**: single project extending the existing `src/`; unit tests colocated as
`*.test.ts`, DB-backed tests in `tests/integration/`. The core runs as CLI → service → DB; cron and
the web server are thin callers of the same services. The POC poller keeps running on the droplet
unchanged; Stage 0 code is not wired to X and Stage 0 tasks do not edit the POC directories.

## Complexity Tracking

No constitution violations to justify.

## Open items carried to tasks

- Owner approval for the 6 new dependencies (research.md).
- Droplet resize to 1 GB and Supabase project creation are manual owner steps (quickstart).
- Daily close = Coinbase candle starting 00:00 UTC (verified live 2026-09-29); seed building
  cross-checks a few days against a second source.
