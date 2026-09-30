---
description: "Task list for Stage 0 — Contract Core (offline)"
---

# Tasks: Stage 0 — Contract Core (offline)

**Input**: Design documents from `specs/001-stage0-contract-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: ~55% coverage is the MVP target and a cap, not a floor. Default: do NOT add a test.
Exhaustive only where bugs cost trust: checks, trust, gates, resolution rules, DB triggers. Price
math, needs-info and lifecycle are proven by the corpus, the seeds and a few integration tests; no
extra unit tests for them. CI runs on every PR (T008).

**Rules for every task**
- Do NOT edit the POC directories: `src/commands/`, `src/ingest/`, `src/x/`, `src/poc/`.
- Commit messages: one line, `feat|fix|chore|docs|test(001-T0NN): <short desc>`, no attribution.
- No new dependency beyond the six approved in T001.
- No content stored or logged: no X post text, no quotes, no page snapshots (FR-029). Logs carry
  lengths and IDs only.
- All times UTC. Every external boundary validated with Zod.

**Organization**: Phase 2 builds the whole database first (as requested); then one phase per user
story in priority order.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

**Purpose**: dependencies, scripts, env, local database

- [x] T001 Get owner approval for the six new packages listed in `specs/001-stage0-contract-core/research.md` (fastify, drizzle-orm, drizzle-kit (dev), postgres, node-cron, @google/genai, @sentry/node); record "Approved YYYY-MM-DD" under that table. BLOCKS T002.
- [x] T002 Install the approved packages with npm, pinning exact versions in `package.json` and `package-lock.json`
- [x] T003 [P] Add npm scripts to `package.json` per `contracts/cli.md`: `db:migrate`, `corpus`, `seeds:crypto`, `seeds:open`, `claim:submit`, `claim:amend`, `claim:edit`, `jobs:tick`, `review:list`, `resolve:manual`, `dev`, `test:integration` (all via `tsx --env-file=.env src/cli/<name>.ts`; `test:integration` runs `node --import tsx --test "tests/integration/**/*.test.ts"`); keep the existing `poc:*` scripts unchanged
- [x] T004 [P] Append Stage 0 variables to `.env.example`: `DATABASE_URL`, `GEMINI_API_KEY`, `NORMALIZER_MODEL`, `JUDGE_MODEL_A`, `JUDGE_MODEL_B`, `ARBITER_MODEL`, `LLM_MODE=replay`, `SENTRY_DSN`, `PORT=3000` (comments say which are needed only for live/record)
- [x] T005 [P] Add `compose.yaml` at repo root with one `postgres:16` service (port 5432, password `dev`, named volume) for local dev and integration tests; add `test-db` notes to `specs/001-stage0-contract-core/quickstart.md`
- [x] T006 Add `loadCoreConfig()` to `src/config.ts` next to the POC's `loadConfig()` (do not change `loadConfig`): Zod schema for the T004 variables, `DATABASE_URL` required, model IDs required only when `LLM_MODE` is `live` or `record`
- [x] T007 [P] Add `drizzle.config.ts` at repo root (dialect postgresql, schema `src/db/schema.ts`, out `drizzle/`, credentials from `DATABASE_URL`)
- [x] T008 [P] Add `.github/workflows/test.yml` running on `pull_request` and push to `main`: Node 22, `npm ci`, `npm run typecheck`, `npm test` with coverage report (node built-in `--experimental-test-coverage`, report only, no threshold), `npm run test:integration` against a `postgres:16` service container, then `npm run corpus` and `npm run seeds:crypto` in `LLM_MODE=replay` (no secrets needed); steps whose scripts don't exist yet are added as their tasks land — corpus step later dropped: recordings are local only (research R5)

---

## Phase 2: Foundational — Database first (blocks all user stories)

**Purpose**: the five tables, every constraint and trigger, RLS, and the shared building blocks
(contract schema, lifecycle table, model client). Source of truth: `data-model.md`.

- [x] T009 Define the five tables in `src/db/schema.ts` with Drizzle exactly as in `data-model.md`: `claims`, `positions`, `evidences`, `resolutions`, `cost_events`; every enum column as text + `check()` constraint; `UNIQUE(claims.slug)`, `UNIQUE(claims.source_tweet_id)`, `UNIQUE(positions.claim_id, positions.x_user_id)`, `UNIQUE(positions.join_tweet_id)`, `UNIQUE(resolutions.claim_id)`; FKs `positions/evidences/resolutions/cost_events.claim_id → claims.id`, `resolutions.deciding_evidence_id → evidences.id`; indexes from data-model.md
- [x] T010 Create `src/db/client.ts`: postgres.js connection from `loadCoreConfig().DATABASE_URL` (max 5 connections, `prepare: false` for the Supabase pooler), exported Drizzle `db`, `closeDb()`
- [x] T011 Generate the base migration with `npx drizzle-kit generate` into `drizzle/0000_init.sql`; review it by hand against data-model.md
- [x] T012 Write `drizzle/0001_triggers.sql` by hand: (a) partial unique index `positions(claim_id) WHERE is_author`; (b) `claims_contract_frozen` BEFORE UPDATE — when OLD.status ∈ (locked, resolving, resolved, void, expired, rejected) reject changes to contract, deadline_at, resolution_method, lock_at, locked_source_version, locked_source_hash; (c) `claims_status_transition` BEFORE UPDATE OF status — allow only the pairs in data-model.md Lifecycle, refuse any change from rejected/expired/resolved/void; (d) `positions` and `evidences` BEFORE UPDATE OR DELETE → raise; (e) `claims_insert_status` BEFORE INSERT — status ∈ (parsing, draft, needs_info, rejected); (f) `resolutions_final_frozen` BEFORE UPDATE OR DELETE — reject when OLD.review_status = 'final'; register it in `drizzle/meta/_journal.json`
- [x] T013 Write `drizzle/0002_rls.sql`: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on all five tables, no policies; comment explaining the owner-role access model from data-model.md
- [x] T014 Create `src/cli/db-migrate.ts` using Drizzle's migrator over `drizzle/`; exits non-zero on failure
- [x] T015 [P] Create `src/lifecycle/transitions.ts`: the Lifecycle table as a typed constant (identical pairs to T012c), `TERMINAL_STATES`, `canTransition(from, to)`, `assertTransition()` throwing a clear error (early refusal; the DB trigger stays the authority)
- [x] T016 [P] Create `src/contract/schema.ts`: `ContractSchema` (Zod) exactly as data-model.md — subject, criterion, deadline_at (UTC ISO), source {name, kind, locator (URL), scope, entity_id, absence_is_meaningful, fallback:'same_issuer_only'}, negative_condition, resolution_method, price? (required iff price_feed: provider 'coinbase', product_id, comparison CLOSE_ABOVE|CLOSE_BELOW, threshold > 0, window_mode)
- [x] T017 [P] Create `src/contract/render.ts`: `renderStatement(contract)` — fixed template, the only source of the public statement; price claims render "BTC-USD daily close (UTC) above $150,000 on any day by 2026-12-31"
- [x] T018 [P] Create `src/contract/slug.ts`: 5-char slug from alphabet without 0/O/1/I/l; `newSlug(existsFn)` retries, widens to 6 after 3 collisions
- [x] T019 [P] Create `src/llm/replay.ts`: replay store in `fixtures/replay/` keyed by SHA-256(model id + instruction version + input); `get`, `put`; stores model responses (quote replaced by its sha256 + recorded `quote_found`), search results, per fetch only `{url, sha256, retrieved_at, status}`, Coinbase responses; the entry Zod schema has no page-text or quote field (test tooling only, research R5)
- [x] T020 Create `src/llm/client.ts`: Gemini wrapper over `@google/genai` with `LLM_MODE` live|record|replay (via T019), JSON output parsed by a passed Zod schema, returns `{data, usage}`; optional Google Search grounding flag returning grounding metadata; every live call returns its cost; the caller records it via T021 (buffered until the claim exists, data-model "Cost rows"); prices in `src/llm/prices.ts` are UNRECONCILED
- [x] T021 [P] Create `src/db/costs.ts`: `recordCost({claimId, provider, operation, units, usdCost})` with Zod-checked enums from data-model.md
- [x] T022 [P] Create `src/observe.ts` per research R11: `initObservability(service)` (Sentry with `dataCollection` off for user info, headers, bodies, gen-AI inputs, DB params and stack variables, logs on (Sentry 11 sends them by default), scrubber dropping `text|quote|body|prompt` fields; no-op without `SENTRY_DSN`), `alert(event, fields)` (Sentry warning event → email), `flush()`; extend `src/log.ts` (keep its signature) so each line has `event` + IDs and is also forwarded to Sentry Logs; `src/jobs/lock.ts` `withJobLock(name, fn)` using `pg_try_advisory_lock` (skip if held); only the lock job sends a Sentry cron monitor check-in (free plan: 1 monitor)
- [x] T023 Create `tests/integration/helpers.ts`: connect to the compose Postgres, create a fresh database per run, run migrations (T014), `truncateAll()`, factory helpers `insertClaim(overrides)`, `insertPosition()`, `insertEvidence()`
- [x] T024 [P] Write `tests/integration/db.test.ts`: locked claim rejects contract/deadline/lock_at/locked_source_* changes, draft accepts them; every (from, to) status pair matches `canTransition` from T015; positions and evidences reject UPDATE and DELETE; duplicate `source_tweet_id`, second author position and second resolution rejected; invalid enum rejected by CHECK; claim inserted as locked rejected; final resolution rejects UPDATE, needs_human one accepts it

**Checkpoint**: `npm run db:migrate` works on local Postgres; `npm run test:integration` green.

---

## Phase 3: User Story 1 — Any clear prediction becomes a checkable contract (P1) 🎯 MVP

**Goal**: text → proposed contract → deterministic checks → recorded / needs info / rejected, one
claim per tweet.

**Independent Test**: `npm run corpus` in replay mode reports ≥ 90% expected outcomes (SC-001).

- [x] T025 [P] [US1] Write `src/llm/instructions/normalize.v1.md`: instructions for ProposalSchema (contracts/llm-schemas.md) — any topic, explicit deadline only (calendar phrases like EOY/Q3/"in 6 months" map to a fixed date; event phrases like "this season"/"next election" → unclear deadline), bare date → 23:59:59Z, pick the official record as `source.locator`, set `absence_is_meaningful` only for exhaustive official registers, intraday wording → unclear
- [x] T026 [US1] Create `src/llm/normalize.ts`: `proposeContract(text, todayUtc)` using T020 with `ProposalSchema`; one retry on schema failure, then return `{kind:'malformed'}`
- [x] T027 [P] [US1] Create `src/contract/checks.ts`: pure `runChecks(proposal, now, {sourcePostClaimed})` implementing FR-003 in order (prediction, X rules, explicit deadline, > 24 h, ≤ 10 years, nothing unclear, objectively decidable, structured source, negative condition, not duplicate) → `recorded | needs_info(unclear[]) | rejected(reason)`; self_confidence ignored
- [x] T028 [P] [US1] Write `src/contract/checks.test.ts`: every check, boundary at exactly 24 h and exactly 10 years, missing negative condition, price contract without `price`, reject reasons map to data-model enum
- [x] T029 [P] [US1] Create `src/feeds/coinbase.ts`: Zod-validated client for `/products/{id}` and `/products/{id}/candles?granularity=86400` (≤ 300 per request, paging by start/end, candles as `[time, low, high, open, close, volume]`); `productExists(id)` for FR-004; responses go through the replay store
- [x] T030 [P] [US1] Create `src/replies/templates.ts` with RECORDED, REJECTED (reason in words; X-rules generic text), ALREADY RECORDED per `contracts/reply-templates.md`; `assertReplyFits(text)` ≤ 280 chars, URL as plain text
- [x] T031 [US1] Create `src/lifecycle/claims.ts` `submitClaim({text, authorId, sourceTweetId, summonTweetId, sourceVersion, now})`: propose (T026) → checks (T027; price contracts also T029 `productExists`) → in one transaction insert the claim with `INSERT … ON CONFLICT (source_tweet_id) DO NOTHING RETURNING` plus the author position (agree) plus the buffered `cost_events` of this call; rejected outcomes are inserted too (status rejected, `reject_reason`, contract null); store `contract_model_id` and `self_confidence`; duplicate → rejected pointing at the existing slug, its cost rows written with `claim_id` null; log `claim.submitted` (outcome, reason, slug, model, cost); recorded → status draft, `lock_at = now + 15 min`; mirror `deadline_at` and `resolution_method`; returns the reply text (not stored)
- [x] T032 [US1] Create `src/cli/claim-submit.ts` (`--text --author --post`, `--now` optional) printing the claim slug, status and reply
- [x] T033 [P] [US1] Write `fixtures/corpus/*.jsonl`: 100 fixtures in real X language across groups (well_formed, vague_magnitude, missing_deadline, temporal_phrases (calendar → recorded, event phrases like "this season" → needs_info), commitment_phrasing, ambiguous_entity, sports, health/science/tech/business/politics/culture, intraday_wording, not_prediction, deadline_out_of_range), format per `contracts/cli.md`, each with expected outcome and key contract fields
- [x] T034 [US1] Create `src/cli/corpus.ts`: runs every fixture through T026+T027 (no DB), prints one JSON line per fixture and a summary with pass rate by group; exit 1 below 90%
- [x] T035 [US1] Run `LLM_MODE=record npm run corpus -- --model <cheapest Flash tier>`, move up a tier only if < 90%; keep the recordings in `fixtures/replay/` (local only, research R5) and commit the chosen `NORMALIZER_MODEL` in `.env.example` comments — chose `gemini-3.1-flash-lite` (cheapest available; 100/100, $0.06 per full run)
- [x] T036 [US1] Write `tests/integration/submit.test.ts`: two concurrent `submitClaim` for the same tweet → exactly one claim, the other a duplicate; author position created in the same transaction; no post text in any column

**Checkpoint**: corpus ≥ 90% in replay; claims can be created offline.

---

## Phase 4: User Story 2 — An unclear prediction gets concrete examples (P1)

**Goal**: case A — one NEEDS INFO reply with checked, topic-specific examples; amend from needs info.

**Independent Test**: vague fixtures produce replies that name what is unclear, include ≥ 1 example
that itself passes the checks, use the amend format and fit 280 chars (SC-005).

- [x] T037 [US2] Add NEEDS INFO frame and the fixed fallback example to `src/replies/templates.ts`
- [x] T038 [US2] Create `src/replies/needs-info.ts` `buildNeedsInfoReply(proposal, now)`: run each proposed example through `proposeContract` + `runChecks` as an amend; drop failures; regenerate once if none survive; else use the fallback; never return an unchecked example; assert length
- [x] T039 [US2] Extend `submitClaim` in `src/lifecycle/claims.ts`: needs-info outcome → status needs_info, `unclear`, `needs_info_since = now`, reply from T038
- [x] T040 [US2] Add `amendClaim({slug, authorId, text, now, reader})` (refuse if `authorId` is not the claim author) for status needs_info in `src/lifecycle/claims.ts`: valid → draft with contract, `lock_at = now + 15 min`, `source_version` = current version from `reader`, amend_count unchanged; still unclear → stays needs_info with one short reply
- [x] T041 [US2] Create `src/lifecycle/expire.ts` `expireNeedsInfo(now)`: needs_info older than 24 h → expired, no reply
- [x] T042 [US2] Create `src/cli/claim-amend.ts` (`--slug --text`, `--now` optional)
- [x] T043 [US2] Extend `src/cli/corpus.ts` to check SC-005 on every needs-info fixture (unclear named, ≥ 1 checked example, amend format, ≤ 280) and print the count

**Checkpoint**: vague predictions get useful replies; an amend turns them into drafts.

---

## Phase 5: User Story 3 — A locked claim is resolved correctly (P1)

**Goal**: gated evidence → one resolution per claim (evidence / arbiter / human flag).

**Independent Test**: `npm run seeds:crypto` 100% and `npm run seeds:open` ≥ 95% agreement with
< 5% wrong HIT/MISS on the SC-003 mix (SC-002–004, SC-010).

- [x] T044 [P] [US3] Create `config/source-policy.json` version 1: curated `official` domains per issuer and `trusted` lists per kind (football_results, league_tables, regulatory, elections, company_filings, science) as in data-model.md
- [x] T045 [P] [US3] Create `src/resolve/trust.ts` `trustLevel(url, contract, policy)`: price feed → official; registrable domain on the policy `official` list → official; listed under `contract.source.kind`, or equal to the domain of `contract.source.locator` → trusted; else other (a contract-named domain is never official by itself). Plus `loadSourcePolicy()` (Zod)
- [x] T046 [P] [US3] Write `src/resolve/trust.test.ts`: subdomains, official list, contract locator not on the list → trusted (never official), unknown kind selects no list, lookalike domains (`fda.gov.evil.com`)
- [x] T047 [P] [US3] Create `src/resolve/gates.ts` pure `runGates(evidenceDraft, contract, lockAt, deadlineAt, others)`: trusted, quote_found (in-memory text includes the quote after whitespace normalisation; n/a for absence and price feed), in_window (`(lock_at, deadline_at]`; for absence: read at ≥ deadline and `absence_is_meaningful`), final, independent (different registrable domain, extracted text not near-identical to another item in the same run by in-memory word-shingle similarity, different judge `original_source`) → `{gates, passed}`
- [x] T048 [P] [US3] Write `src/resolve/gates.test.ts`: every gate pass/fail, absence basis, pending fails final, entity_gone, boundary exactly at lock_at and deadline_at
- [x] T049 [P] [US3] Create `src/resolve/decide.ts` pure `decideResolution(evidences, now, deadlineAt)` implementing the data-model rule table: receives all runs' evidence; HIT/MISS/contradiction from the latest run only, waiting rules count earlier runs by `run_at`; only the highest trust level present decides (any passed official → trusted ignored); 2 trusted agree; hit/miss disagreement within that level → `needs_arbiter`; lone trusted → needs_human; official pending → wait, > 30 days after deadline → needs_human; official entity_gone in 3 separate runs → VOID unresolvable, fewer → wait; none (empty search counts as checked) → VOID insufficient_evidence only if the previous run ≥ 24 h earlier also had none, else wait; returns `deciding_evidence_id` or a wait reason
- [x] T050 [P] [US3] Write `src/resolve/decide.test.ts` covering every row of the rule table plus mixed cases (official hit + trusted miss → final HIT by official, official hit + official miss → needs_arbiter, other-only → VOID, contract locator alone → needs_human, locator + one trusted agreeing → final, entity_gone on 1 and 2 runs → wait, empty search once → wait, twice ≥ 24 h apart → VOID, earlier-run HIT but latest run irrelevant → decided on latest only)
- [x] T051 [US3] Create `src/resolve/price-evidence.ts`: fetch all candles in `(lock_at, deadline_at]` via T029 (paging), daily close = candle starting 00:00 UTC, strict CLOSE_ABOVE/CLOSE_BELOW, `at_deadline` vs `any_time_before`; HIT from any observed qualifying close; MISS only if every day the answer depends on has a close, else `says = pending` (a gap never becomes MISS); one evidence row (basis record, official, value, event_date, response sha256); unknown product → entity_gone (covered by the crypto seeds T058, no separate unit test)
- [x] T052 [P] [US3] Create `src/resolve/fetch.ts`: fetch URL with 15 s timeout and size cap, follow redirects, extract visible text in memory, return `{url, text, sha256, retrievedAt}`; errors → throw typed `SourceUnavailable`; the replay store records only `{url, sha256, retrievedAt, status}`, never the text
- [x] T053 [P] [US3] Write `src/llm/instructions/search.v1.md`, `judge.v1.md`, `arbitrate.v1.md` per `contracts/llm-schemas.md` (judge sees one snapshot and the locked contract; returns says, basis, quote, event_date, flags; arbiter picks one evidence id or cannot_decide)
- [x] T054 [US3] Create `src/llm/search.ts` (grounded call → URLs + queries only), `src/llm/judge.ts` (JudgeSchema, no tools), `src/llm/arbitrate.ts` (ArbiterSchema, id must be one of the given rows)
- [x] T055 [US3] Create `src/resolve/web-evidence.ts`: search (two independent passes with `JUDGE_MODEL_A` and `JUDGE_MODEL_B`) → fetch → judge per snapshot → `trustLevel` → `runGates` → insert evidences rows with shared `run_at`; a search that returns nothing inserts one row (`url` null, `search_query`, `says = irrelevant`, `passed = false`) so the run is countable; an outage inserts nothing; the quote and page text are dropped after gating; for contracts with `absence_is_meaningful` also read `source.locator` after the deadline for absence evidence
- [x] T056 [US3] Create `src/resolve/resolver.ts` `resolveDueClaims(now)`: claims in locked/resolving with `next_check_at ≤ now` and no resolution row (needs_human is never re-run) → resolving; gather evidence (price feed only for price claims; web otherwise); `decideResolution`; `needs_arbiter` → arbitrate → final or needs_human; upsert the single resolution row (outcome, decided_by, review_status, deciding_evidence_id, arbiter notes, policy_version, decided_at); final → claim resolved/void and `next_check_at` null; wait → push `next_check_at` per the data-model **Resolver schedule** (outage +1 h doubling to 24 h; pending/gap/insufficient/entity_gone +1, 2, 4, 8 days); `SourceUnavailable`/schema errors → no evidence; log `resolver.run` and `resolution.decided`; `needs_human` and cost > $0.30 → `alert()`
- [x] T057 [US3] Create `src/cli/review-list.ts` (needs_human resolutions with their evidence links) and `src/cli/resolve-manual.ts` (`--slug --outcome --deciding-evidence --note`: only for `needs_human` rows, refuses final ones; sets decided_by human, review_status final, human_notes; claim → resolved/void)
- [x] T058 [P] [US3] Write `fixtures/seeds/crypto/*.json`: 60 historical price claims with frozen Coinbase candles and expected outcomes (exact threshold, UTC boundary, gap with a HIT elsewhere → HIT, gap that blocks a MISS → pending then needs_human, delisted product)
- [x] T059 [P] [US3] Write `fixtures/seeds/open/*.json`: ≥ 60 historical open-topic claims tagged with the SC-003 categories at their minimum counts, each with `expected_outcome` and a note why
- [x] T060 [US3] Create `src/cli/seeds.ts` for `seeds:crypto` and `seeds:open`: load seeds into a scratch database, run the resolver as of just after each deadline, report agreement, wrong HIT/MISS, needs_human count, per-category results; fail if a category is below its minimum or thresholds are missed
- [x] T061 [US3] Paid live runs dropped (owner decision 2026-09-30): no re-record of `corpus` / `seeds:open`; accuracy is checked by the owner with ~3 real claims at release. Last recorded run (2026-09-30, fixed site list): 59% agreement, 0 wrong HIT/MISS
- [x] T062 [US3] Write `tests/integration/resolver.test.ts`: outage → no evidence, claim stays resolving; needs_human keeps resolving; manual decision finalises; one resolution per claim across repeated runs; price claims never call the web path

### Phase 5a: Earned trust instead of a fixed site list (constitution 2.0.0)

- [x] T081 [US3] Migration: `evidences.trust_level` CHECK → (primary, established, weak), add `evidences.trust_reason text`; drop `resolutions.policy_version`; create `sources` (domain PK, agreed_count ≥ 1, first_agreed_at, last_agreed_at), RLS on with no policies; update `src/db/schema.ts` and the DB tests' table list
- [x] T082 [US3] Judge `judge.v2` (`src/llm/instructions/judge.v2.md`, `src/llm/judges.ts`): add `source_trust` + `trust_reason` per `contracts/llm-schemas.md`; recorded shape keeps both
- [x] T083 [US3] Replace `src/resolve/trust.ts` with pure `capTrust(rated, url, contract)` (price feed → primary; primary only on the locator's registrable domain, else established); rewrite `trust.test.ts` exhaustively; delete `config/source-policy.json` and `loadSourcePolicy`; the closed `source.kind` list stays in the normalize instruction
- [x] T084 [US3] Rename trust levels through gates, decide, web-evidence, price-evidence, resolver, review CLIs and their tests (official → primary, trusted → established, other → weak); absence evidence only from a primary page
- [x] T085 [US3] Create `src/resolve/sources.ts`: `knownSources(db)` (agreed_count ≥ 5) passed to `search.v2`; `recordSourceStanding(tx, claimId, outcome)` upserting once per registrable domain whose found-quote evidence matched the outcome, called in the transaction that writes a final HIT/MISS (resolver and `resolve-manual`); integration test: re-runs and several pages from one site count once, wrong sites, VOID and needs_human count nothing
- [x] T087 [US3] Review fixes: a run with transient fetch errors or unusable judge answers that settled nothing is an outage, never "nothing found" (404/403 stay real answers; replay misses fail loudly); a run with a primary pending/entity_gone is never an empty run toward VOID, and those need the quote on the page; costs recorded on thrown paths; arbiter down → outage backoff, arbiter answer unusable → needs_human; fallback example dated end of next year; needs-info examples checked against the price feed; the malformed-proposal explanation reaches the reply; amends past the 24 h window refused, still-unclear update guarded by status; any outage (incl. arbiter down) 30 days past the deadline → needs_human; every page unreadable although search found pages → outage; one bad judge answer only skips that page; seeds start each claim with no known sources
- [x] T088 [US2] No `amend` keyword: any reply from the author under a bot reply is the corrected prediction; reply frames say "reply with the prediction and a date" / "reply with the corrected prediction"; `claim:amend` → `claim:reply` (`src/cli/claim-reply.ts`); spec US2/FR-007/FR-010, `contracts/reply-templates.md`, `contracts/cli.md`
- [x] T089 [US2] Only two user actions for now (record, short-time fix): anything that isn't a prediction (e.g. "@vaticeno cancel") gets the help reply listing them, and so does `@vaticeno help` (no model call, no claim) (`src/replies/templates.ts`, `contracts/reply-templates.md`); opt-out (`STOP`) not built or offered yet (spec Assumptions); README commands synced

**Checkpoint**: seeds pass; hypothesis D answered on historical data.

---

## Phase 6: User Story 4 — The contract lifecycle is trustworthy (P2)

**Goal**: amends and tweet edits before lock, lock at `lock_at`, nothing changes after.

**Independent Test**: every US4 acceptance scenario passes against Postgres (SC-007).

- [x] T063 [US4] Add `[AMENDED]` and `[EXPIRED]` templates to `src/replies/templates.ts` per `contracts/reply-templates.md`
- [x] T064 [US4] Extend `amendClaim` in `src/lifecycle/claims.ts` for status draft: refuse when `now ≥ lock_at` or `amend_count = 2`; valid → replace contract, `amend_count + 1`, `lock_at = now + 15 min`, `source_version` = current version from `reader`, `[AMENDED]` reply; failed amend does not count; log `claim.amended`
- [x] T065 [US4] Create `src/lifecycle/source-reader.ts`: `SourceReader` interface `{readVersion(tweetId) → {versionId, text}}` with a fixture-backed implementation for Stage 0 (X implementation comes in Stage 1); `src/cli/claim-edit.ts` writes a simulated edit into it
- [x] T066 [US4] Create `src/lifecycle/lock.ts` `lockDueDrafts({...deps, reader}, now)`: for drafts with `lock_at ≤ now` re-read the tweet; version changed → run `proposeContract` + `runChecks` on the edited text: passes and `amend_count < 2` → replace contract, `source_version`, `amend_count + 1`, `lock_at = now + 15 min`, `[AMENDED]` reply; fails or limit reached → expired with `[EXPIRED]` reply (never lock the pre-edit contract); unchanged → set locked_source_version and locked_source_hash (SHA-256 of text, text discarded), `next_check_at = deadline_at` and status locked; log `claim.locked` / `claim.expired`; drafts past deadline → expired
- [x] T067 [US4] Create `src/cli/jobs-tick.ts` (`--now`): runs `lockDueDrafts`, `expireNeedsInfo`, `resolveDueClaims` once, in that order, each inside `withJobLock`
- [x] T068 [US4] Write `tests/integration/lifecycle.test.ts` for US4 scenarios 1–7 (frozen after lock, terminal states, third amend refused, amend at exactly lock_at refused, 15-minute lock and restart, edit found at lock → [AMENDED], edit failing checks or at the limit → expired and never locked, locked version + hash recorded)

**Checkpoint**: full claim life works with simulated time.

---

## Phase 7: User Story 5 — Anyone can see a claim and an author's record (P3)

**Goal**: public, read-only, server-rendered pages.

**Independent Test**: pages for seeded claims in each state and one author show every required
element, no percentage or ranking, no content (SC-009).

- [x] T069 [P] [US5] Create `src/web/html.ts`: `html` tagged template with escaping, `layout(title, body)`
- [x] T070 [US5] Create `src/web/claim-page.ts` per `contracts/http.md`: rendered statement, criterion, source, negative condition, status, created/lock/resolve times, deadline countdown, evidence items (source, trust level, says, link, value, event date, read at, gates), resolution (decided_by, notes, deciding evidence), link to the X post, positions
- [x] T071 [US5] Create `src/web/author-page.ts`: claims the user holds a position on, derived right/wrong/void, raw counts only
- [x] T072 [US5] Create `src/web/server.ts` (Fastify): `GET /c/:slug`, `GET /u/:x_user_id`, `GET /healthz`; 404s; no admin routes; `npm run dev` starts it
- [x] T073 [US5] Write `tests/integration/pages.test.ts` using Fastify `inject`: one claim page and one author page render required elements, no `%`, no fixture text, `<script>` in a contract field comes out escaped

---

## Phase 8: Polish & Cross-Cutting

- [x] T074 Create `src/jobs/scheduler.ts`: node-cron calls `lockDueDrafts` every minute, `expireNeedsInfo` every 10 minutes, `resolveDueClaims` hourly — same functions as `jobs:tick`, each inside `withJobLock`; started from `src/web/server.ts` behind `ENABLE_JOBS=true`
- [x] T075 [P] Wire observability: `initObservability` in `src/web/server.ts` and every `src/cli/*` entry (uncaught errors captured, `flush()` before exit); `/healthz` reports `needs_human` and in-memory `last_resolver_run_at`; `deploy/journald-vaticeno.conf` (`SystemMaxUse=500M`); document in `quickstart.md` where to look (journalctl, Sentry Issues/Logs/Crons) and the uptime check on `/healthz`
- [x] T076 [P] Write `tests/integration/no-content.test.ts` for SC-008 with stub models (no paid runs): one claim through submit → fix → lock → web resolution, then scan every text/jsonb column and the captured logs for the post text, fix text, page text and quote (recorded answers are local only, research R5, so `fixtures/replay/` is not scanned)
- [x] T077 [P] Add per-claim cost summary to `seeds:open` and `corpus` output; fail if any claim exceeds $0.30
- [x] T078 [P] Add `deploy/backup.sh` (nightly `pg_dump` of Supabase to off-box storage) and a systemd timer `deploy/vaticeno-backup.timer`; document one restore test in `quickstart.md`
- [x] T079 [P] Add `deploy/Caddyfile` for `vaticeno.app` → `localhost:3000`
- [x] T080 Update `README.md` (Stage 0 status, new scripts) and walk through `quickstart.md` end to end; fix any drift

---

## Phase 9: X connection (owner decision 2026-09-30: live on X now)

**Goal**: real mentions go through the engine and get one reply each, in the thread.

- [x] T090 `src/bot/mentions.ts`: `routeMention` (ping; help; a reply in the thread of the author's open claim = a fix, no keyword; empty mention under your own post records that post; under someone else's post → refused; otherwise the mention text is the prediction) and `pollMentions` (cursor moves per handled mention; an outage leaves the rest for the next poll; one reply per mention, never retried; allowlist and caps)
- [x] T091 `src/bot/x-source-reader.ts` (current version = last id in edit history) and `src/bot/wire.ts` (X client, OAuth reply poster with one 401 refresh); `getTweet` in `src/x/client.ts`
- [x] T092 Scheduler `mentions` job every minute behind `ENABLE_X=true`; the lock job reads posts from X; replies drop the page link (no domain yet)
- [x] T093 `deploy/vaticeno.service` runs `src/web/server.ts` (pages on localhost, jobs, X); constitution VI 2.1.0; `tests/integration/bot.test.ts`
- [x] T094 Fixes found by thread: every bot reply and fix id is kept on the claim (`drizzle/0004_thread_tweet_ids.sql`), so a reply under any bot answer is a fix even inside an older thread; `tests/integration/bot.test.ts`
- [x] T095 Review high: fixes matched by the direct parent only; others' replies ignored without a model call; cap checked before recording; a mention saved as answered before the post; a mention failing 3 polls is skipped with an alert; page-limit alert; docs synced
- [x] T096 STOP opt-out: a STOPPED reply, opted out until the author tags the bot again (`opt_outs` table, `drizzle/0005_opt_outs.sql`); statement drops the source name; `tests/integration/bot.test.ts`
- [x] T097 Matches soon: sports claims only need the deadline after the lock; judge.v3 reports the kickoff (time zone stated), stored as `evidences.event_start` (`drizzle/0006_evidence_event_start.sql`); the evidence counts if the match began after the contract's last change and by the deadline (`src/resolve/gates.ts`, `src/contract/checks.ts`, `src/llm/instructions/judge.v3.md`); seeds replay with judge.v2 (no paid re-record). Known: open-topic seed recordings predate search.v2 and don't replay

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2 (DB)** → user stories.
- **US1** needs Phase 2. **US2** needs US1 (`proposeContract`, `runChecks`, `submitClaim`) and the `SourceReader` from T065 (build that file first; amends read the current tweet version).
- **US3** needs Phase 2 only (seeds insert locked claims directly); it can run in parallel with US1/US2
  after T020, but T029 (Coinbase client) is shared — do T029 first.
- **US4** needs US1 (`submitClaim`) and US2 (`amendClaim`); T067 also needs US3's resolver.
- **US5** needs Phase 2; realistic pages need US3 data.
- **Polish** after the stories it touches.

## Parallel Examples

- Phase 2 after T009–T014: T015, T016, T017, T018, T019, T021, T022 together; then T024.
- US1: T025, T027, T028, T029, T030, T033 together; then T026 → T031 → T032/T034.
- US3: T044–T050, T052, T053 together; T058 and T059 (seed writing) in parallel with code.

## Implementation Strategy

1. **Database first** (Phases 1–2): migrations, triggers and integration tests green.
2. **MVP = US1**: corpus ≥ 90% in replay mode.
3. **Answer hypothesis D early**: US3 seeds can start right after Phase 2; if SC-003 fails, stop and
   rethink before building pages.
4. Then US2 → US4 → US5 → Polish.
5. Commit after each task or tight group: `feat(001-T0NN): <desc>`.
