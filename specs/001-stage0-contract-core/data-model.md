# Data Model: Stage 0 — Contract Core

Postgres (Supabase). Six tables. All timestamps `timestamptz`, stored UTC. Every enum column has a
CHECK constraint. No content is stored: not the X post text, not quotes or snapshots of external
sources — only links, IDs, hashes and our own contract (FR-029). Visual version: the "Vaticeno Data
Model" artifact.

## Tables at a glance

| Table | What it stores | Why we need it |
|---|---|---|
| claims | the bet: fixed contract, state, lock/deadline | the one thing that gets judged; one tweet = one claim |
| positions | who is on which side: agree/disagree | many people per bet later without a migration; MVP writes only the author |
| evidences | what each checked source said, with its proof and gate results | the receipts; only evidence that passes every gate counts |
| resolutions | one per claim: final outcome, how it was reached, arbiter notes, human-review flag | the verdict and its explanation; flags the cases a human must decide |
| cost_events | every paid call and its cost | keeps spend under $0.30 per claim |
| sources | per site: how many final verdicts its evidence agreed with | sites earn "known" standing (≥ 5) instead of a fixed list; known sites are searched first |

## Access model

```
browser → Fastify (server-rendered pages) → backend DB role → Postgres
```
- The backend connects with the **database owner role** (`postgres`) through the Supabase session
  pooler; RLS does not restrict the owner role, so the application works normally.
- RLS is **enabled with no policies** on all six tables, so Supabase's public REST/GraphQL API
  (anon/authenticated roles) sees nothing. The browser never talks to the database.
- The connection string lives only in the droplet's `.env`.

## claims

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| slug | text UNIQUE NOT NULL | 5 chars, alphabet without 0/O/1/I/l; 6 after 3 collisions (FR-018) |
| source_tweet_id | text UNIQUE NOT NULL | one tweet = one claim (FR-003a); insert with `ON CONFLICT DO NOTHING RETURNING` |
| summon_tweet_id | text NOT NULL | the tweet that tagged the bot |
| thread_tweet_ids | text[] NOT NULL DEFAULT '{}' | ids of the bot's replies and the author's fixes for this claim; a reply to any of them is a fix, however deep the thread (ids only) |
| source_version | text NOT NULL | version of the original tweet the current draft was built from (X edit history); compared at lock time to detect edits |
| locked_source_version | text null | version ID of the user's tweet at lock; written once, at lock |
| locked_source_hash | text null | SHA-256 of the user's tweet text at lock (the text itself is never stored); written once, at lock |
| author_x_user_id | text NOT NULL | X numeric ID |
| contract | jsonb null | `ContractSchema`; null while parsing / needs info / rejected |
| contract_model_id | text null | model id + instruction version that wrote the current contract (audit, corpus regressions) |
| self_confidence | real null | the model's own confidence at proposal; recorded for analysis, never a check (FR-003) |
| resolution_method | text CHECK (price_feed, model) null | mirrored from contract for indexing |
| deadline_at | timestamptz null | mirrored from contract for the due-claims index |
| status | text NOT NULL CHECK (parsing, needs_info, draft, locked, resolving, resolved, void, rejected, expired) | |
| reject_reason | text CHECK (not_prediction, x_rules, deadline_too_close, deadline_too_far, duplicate) null | |
| unclear | jsonb null | what is missing, while in needs_info |
| amend_count | int default 0 | successful amends and tweet edits from draft; max 2 |
| lock_at | timestamptz null | last contract reply + 15 min; reset by a valid amend. The claim **is** locked at this instant: amends at or after it are refused even before the status flips; the evaluation window starts here |
| needs_info_since | timestamptz null | 24 h expiry clock |
| next_check_at | timestamptz null | when the resolver may look at this claim next; set to `deadline_at` at lock, pushed back after a run that had to wait (see **Resolver schedule**); null once a resolution exists |
| created_at | timestamptz default now() | |

**Triggers (the database is the authority)**
- `claims_contract_frozen` — BEFORE UPDATE: once `OLD.status` is locked, resolving, resolved, void, expired or rejected,
  reject changes to `contract`, `deadline_at`, `resolution_method`, `lock_at`,
  `locked_source_version`, `locked_source_hash`.
- `claims_status_transition` — BEFORE UPDATE OF status: reject any (old, new) pair not in the
  Lifecycle table; terminal states never change. Code (`src/lifecycle/transitions.ts`) refuses the
  same transitions early for clearer errors; a test asserts the two tables are identical.
- `claims_insert_status` — BEFORE INSERT: status must be `parsing`, `draft`, `needs_info` or
  `rejected` (a claim can't be born locked or resolved). Stage 0 inserts the final outcome of the
  proposal directly; `parsing` is reserved for Stage 1's async intake.

Every summon that is not a duplicate inserts a claim row, including `rejected` ones (with
`reject_reason`, contract null), so a re-summon of the same post is a cheap duplicate, not a new
model call.

**Indexes**: `(next_check_at) WHERE status IN ('locked','resolving')` due claims; `(status, lock_at) WHERE status='draft'`;
`(status, needs_info_since) WHERE status='needs_info'`; `(author_x_user_id, created_at DESC)`.

## ContractSchema (jsonb, Zod-validated before every write)

```ts
Contract = {
  subject: string,
  criterion: string,                  // the yes/no condition
  deadline_at: ISODateTime,           // UTC; bare date → 23:59:59Z
  source: {
    name: string,                     // issuing body + record
    kind: string,                     // label only (closed list in the normalize instruction); never grants trust
    locator: string,                  // URL of the record the contract names; the only domain besides the price feed whose pages can be primary
    scope: string,
    entity_id: string,
    absence_is_meaningful: boolean,   // true only for exhaustive records at the locator
    fallback: 'same_issuer_only'
  },
  negative_condition: string,
  resolution_method: 'price_feed' | 'model',
  price?: {                           // required iff resolution_method = 'price_feed'
    provider: 'coinbase',
    product_id: string,               // e.g. BTC-USD
    comparison: 'CLOSE_ABOVE' | 'CLOSE_BELOW',   // strict
    threshold: number,
    window_mode: 'at_deadline' | 'any_time_before'
  }
}
```
Evaluation window is always `(lock_at, deadline_at]`, not stored. The **statement** is rendered
from these fields by `src/contract/render.ts` (fixed template) — never model-authored, never stored.

## positions

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid FK claims | |
| x_user_id | text NOT NULL | |
| stance | text CHECK (agree, disagree) | |
| is_author | bool default false | |
| joined_at | timestamptz default now() | shown publicly |
| join_tweet_id | text UNIQUE null | null for the author |

Constraints: `UNIQUE (claim_id, x_user_id)`; partial unique `(claim_id) WHERE is_author`.
Trigger: insert-only. MVP writes only the author row (agree), in the same transaction as the claim.
A person's result is derived: HIT → agree right / disagree wrong; MISS → reverse; VOID → void.

## evidences — what each source said, and whether it passed the gates

One row per source checked. Rows are written as sources are checked, before the resolution exists.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid FK claims | |
| run_at | timestamptz | the resolver run that produced this row. HIT/MISS/contradiction use the latest run only; the waiting rules (entity_gone ×3, nothing ×2, pending 30 days) also read earlier runs. An empty search writes one row (`url` null, `search_query`, `says = irrelevant`, `passed = false`) so the run is countable; an outage writes none |
| source_kind | text CHECK (price_feed, web) | |
| basis | text CHECK (record, absence) | `record` = the source shows a result; `absence` = the result is not in a source whose contract marks `absence_is_meaningful`, checked on or after the deadline |
| source_name | text | e.g. `coinbase`, `premierleague.com`, `bbc.co.uk/sport` |
| trust_level | text CHECK (primary, established, weak) | rated by the judge model, capped in code (below) |
| trust_reason | text null | the judge's one-line reason for the rating (≤ 200 chars, our derived text, not page content) |
| says | text CHECK (hit, miss, pending, irrelevant, entity_gone) | `hit` / `miss` = the source settles it; `pending` = the result exists but is not final yet (e.g. awaiting certification); `irrelevant` = the source does not answer the question (nothing relevant, too little data); `entity_gone` = the source answers but the entity no longer exists (delisted asset, deleted fixture) |
| event_date | date null | the date the source establishes |
| value | numeric null | price feed answers |
| url | text null | |
| content_sha256 | text null | fingerprint of the fetched page / feed response — proves what was read without storing it |
| search_query | text null | |
| retrieved_at | timestamptz | |
| model_id, instruction_version | text null | when a model read the page |
| gates | jsonb | result per gate, e.g. `{"trusted":true,"quote_found":true,"in_window":true,"final":true,"independent":true}` |
| passed | bool | true only if every applicable gate passed |
| created_at | timestamptz default now() | |

**Trust level** — no fixed site list. The judge model rates each page it reads:
- `primary`: the body that decides or records the outcome itself (the regulator, the league, the
  company, the electoral authority);
- `established`: an outlet with its own reporting and editorial standards;
- `weak`: anything else (blogs, aggregators, user-edited or video sites, unclear origin). Never counts.

Code then caps the rating by `capTrust(rated, url, contract)` (pure, exhaustively tested):
- price-feed evidence is always `primary` (set in code, no model);
- `primary` stands only when the page's registrable domain equals the contract's `source.locator`
  domain — the source fixed at lock. Any other page rated `primary` is stored as `established`, so a
  model can never make an arbitrary site decide a claim alone;
- `established` and `weak` are kept as rated.

Known sources (`sources` table, below) never change a trust level; they only shape the search.

**Evidence gates** (evaluated in code; model flags are inputs, never the final word):

| Gate | Passes when |
|---|---|
| trusted | `trust_level` is `primary` or `established` (`weak` never counts) |
| quote_found | the model's quote occurs in the fetched page (checked in memory; the quote is then discarded, never stored). Not applicable to `basis = absence` and price feeds |
| in_window | the event date is inside `(lock_at, deadline_at]`. For `basis = absence`: instead, the page is `primary` (the contract's own source), was read on or after the deadline, and the contract marks it `absence_is_meaningful` |
| final | the result is final, not a projection or preliminary figure |
| independent | not a copy of another item in the same run: different registrable domain **and** page text not near-identical (word-shingle similarity of the extracted text, computed in memory during the run; the text is then dropped) **and** not attributed to the same original report (the judge's `original_source`, e.g. "AP"). Copies count once |

Insert-only.

## resolutions — one per claim

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid UNIQUE FK claims | |
| outcome | text CHECK (hit, miss, void) null | null while waiting for a human |
| decided_by | text CHECK (evidence, arbiter, human) null | `evidence` = decided directly by passed evidence |
| review_status | text CHECK (final, needs_human) | |
| void_reason | text CHECK (insufficient_evidence, unresolvable) null | |
| deciding_evidence_id | uuid FK evidences null | the evidence that established the outcome: the primary item, the first of the agreeing established items, or the one the arbiter/human sided with. Required when outcome is hit or miss; null only for VOID |
| arbiter_model_id | text null | |
| arbiter_notes | text null | why the arbiter decided (or why it could not) |
| human_notes | text null | set when a human decides (CLI now, admin panel later) |
| decided_at | timestamptz null | |
| created_at | timestamptz default now() | |

**How the resolution is reached** (from the claim's passed evidences):

HIT/MISS/contradiction use the latest `run_at` only; the waiting rows below (entity_gone, nothing
found, pending) count earlier runs as well. `pending`, `irrelevant` and `entity_gone` items never count as HIT
or MISS. A `primary` item saying `pending` (it fails the `final` gate, so `passed = false`, but
this rule reads it anyway) makes the claim wait for the next run; still pending 30 days after the
deadline → `needs_human`.

Only the **highest trust level present** decides: if any `primary` item passed, `established` items
are ignored (shown on the page, never a contradiction). A contradiction is a hit/miss disagreement
**within** that level.

| Passed evidence | Result |
|---|---|
| 1 or more `primary`, all agree | final — `decided_by = evidence` (established items don't matter) |
| no `primary`, 2 or more `established` agree, none contradicting | final — `decided_by = evidence` |
| `primary` items disagree, or (no primary) `established` items disagree | LLM arbiter reads them: decides → final, `decided_by = arbiter` with notes; can't decide → `needs_human` |
| exactly 1 `established`, no `primary` | `needs_human` (one secondary source is not enough) |
| none, but sources were checked (an empty search counts as checked; an error does not) — in 2 runs at least 24 h apart | final VOID, `insufficient_evidence`; after only one such run → wait (late reporting) |
| a `primary` item says `entity_gone` in 3 separate runs (counted from `run_at`) | final VOID, `unresolvable`; fewer runs → wait for the next run |

**Price feed gaps.** HIT may come from any observed close that meets the criterion. MISS needs a
close for **every** day the contract depends on (every day in the window for `any_time_before`, the
deadline day for `at_deadline`). If a missing day could change the answer, the feed row says
`pending` → wait; still missing 30 days after the deadline → `needs_human`. A gap never becomes MISS.

A source that could not be reached writes no evidence; the claim waits for the next run. The claim
moves to `resolved`/`void` only when the resolution is `final`; `needs_human` keeps it in `resolving`
and lists it for the operator (CLI in Stage 0, admin panel later). A human decision updates the row:
`outcome`, `decided_by = human`, `human_notes`, `review_status = final`.

Trigger `resolutions_final_frozen` — BEFORE UPDATE OR DELETE: once `OLD.review_status = 'final'` the
row never changes (a verdict is as immutable as the contract). Correcting a final verdict is
deferred.

**Resolver schedule** (`claims.next_check_at`; waiting runs never burn the budget):
- the resolver picks `locked`/`resolving` claims with `next_check_at ≤ now` and no resolution row;
  a `needs_human` claim is never re-run (it has a resolution row);
- after a run that had to wait: outage → +1 h, doubling up to 24 h; pending, gap, single
  insufficient run or `entity_gone` → +24 h, then 2, 4, 8 days (so 3 `entity_gone` runs span days,
  not hours); pending past 30 days after the deadline → `needs_human`;
- jobs take a Postgres advisory lock per job name, so an overlapping cron run or a manual
  `jobs:tick` never processes the same claim twice.

**Cost rows**: calls made before the claim row exists (proposal, examples) are buffered and written
with the claim insert in the same transaction; for a duplicate summon they are written with
`claim_id = null`.

## cost_events

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid FK claims null | |
| provider | text CHECK (gemini, google_search, coinbase, web_fetch) | |
| operation | text CHECK (normalize, search, judge, arbitrate, fetch, price) | |
| units | int default 1 | |
| usd_cost | numeric(10,5) | |
| created_at | timestamptz default now() | |

## sources — sites earn standing by agreeing with final verdicts

One row per site, created the first time the site **confirms** a final verdict (its answer matched
it). Sites that were only mentioned or were wrong get no row. A counter, not a scan: nothing ever
re-reads `evidences` to count. Claims and evidences hold no reference to this table; the domain
comes from `evidences.url`.

| Column | Type | Notes |
|---|---|---|
| domain | text PK | registrable domain, e.g. `reuters.com` |
| agreed_count | int NOT NULL CHECK (≥ 1) | final HIT/MISS claims this site confirmed |
| first_agreed_at | timestamptz default now() | |
| last_agreed_at | timestamptz default now() | |

**How it counts.** In the same transaction that writes a final HIT/MISS resolution (by evidence,
arbiter or human), for each distinct domain among that claim's evidence whose quote was found and
whose `says` equals the outcome: `INSERT (domain, 1) ON CONFLICT (domain) DO UPDATE SET
agreed_count = agreed_count + 1, last_agreed_at = now()`. Once per domain per claim, so re-runs and
several pages from one site count once. VOID and `needs_human` update nothing.

**Known source** = `agreed_count ≥ 5` (computed when read, not a stored flag). The resolver passes
known domains to the search step as places to look first. Standing never changes a trust level or
decides a claim. Plain table, no triggers; RLS on with no policies.

## Lifecycle (enforced by trigger)

```
parsing    → draft | needs_info | rejected
needs_info → draft | needs_info | expired
draft      → draft | locked | expired
locked     → resolving
resolving  → resolving | resolved | void
terminal: rejected, expired, resolved, void
```
`lock_at = last contract reply + 15 min`; a valid amend resets it. One column: planned lock time while
draft, actual lock time after (the job only flips the status). At `lock_at` the original tweet is
re-read once; if its version differs from `source_version`, the claim does not lock. The edited text
goes through proposal + checks again, exactly like an amend: passes and `amend_count < 2` → new
contract, `[AMENDED]` reply, `lock_at` reset, `amend_count` + 1, `source_version` updated; fails the
checks or the limit is reached → `expired` with one `[EXPIRED]` reply. The pre-edit contract is
never locked against an edited post. An accepted amend also re-reads the tweet and stores its current
version in `source_version`, so an edit made before the amend is not applied again at lock. Only
the claim's author can amend.

## Not in Stage 0

Mention ingestion state, reply delivery, opt-out and display names (Stage 1).

## opt_outs

Authors who sent `@vaticeno STOP` (constitution IV). Never replied to again; their locked claims still resolve.

| Field | Type | Notes |
|---|---|---|
| x_user_id | text PK | X user id |
| created_at | timestamptz NOT NULL | when STOP was received |
