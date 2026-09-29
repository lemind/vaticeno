# Data Model: Stage 0 — Contract Core

Postgres (Supabase). Five tables. All timestamps `timestamptz`, stored UTC. Every enum column has a
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

## Access model

```
browser → Fastify (server-rendered pages) → backend DB role → Postgres
```
- The backend connects with the **database owner role** (`postgres`) through the Supabase session
  pooler; RLS does not restrict the owner role, so the application works normally.
- RLS is **enabled with no policies** on all five tables, so Supabase's public REST/GraphQL API
  (anon/authenticated roles) sees nothing. The browser never talks to the database.
- The connection string lives only in the droplet's `.env`.

## claims

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| slug | text UNIQUE NOT NULL | 5 chars, alphabet without 0/O/1/I/l; 6 after 3 collisions (FR-018) |
| source_tweet_id | text UNIQUE NOT NULL | one tweet = one claim (FR-003a); insert with `ON CONFLICT DO NOTHING RETURNING` |
| summon_tweet_id | text NOT NULL | the tweet that tagged the bot |
| source_version | text NOT NULL | version of the original tweet the current draft was built from (X edit history); compared at lock time to detect edits |
| locked_source_version | text null | version ID of the user's tweet at lock; written once, at lock |
| locked_source_hash | text null | SHA-256 of the user's tweet text at lock (the text itself is never stored); written once, at lock |
| author_x_user_id | text NOT NULL | X numeric ID |
| contract | jsonb null | `ContractSchema`; null while parsing / needs info |
| resolution_method | text CHECK (price_feed, model) null | mirrored from contract for indexing |
| deadline_at | timestamptz null | mirrored from contract for the due-claims index |
| status | text NOT NULL CHECK (parsing, needs_info, draft, locked, resolving, resolved, void, rejected, expired) | |
| reject_reason | text CHECK (not_prediction, x_rules, deadline_too_close, deadline_too_far, duplicate) null | |
| unclear | jsonb null | what is missing, while in needs_info |
| amend_count | int default 0 | successful amends and tweet edits from draft; max 2 |
| lock_at | timestamptz null | last contract reply + 15 min; reset by a valid amend. The claim **is** locked at this instant: amends at or after it are refused even before the status flips; the evaluation window starts here |
| needs_info_since | timestamptz null | 24 h expiry clock |
| created_at | timestamptz default now() | |

**Triggers (the database is the authority)**
- `claims_contract_frozen` — BEFORE UPDATE: once `OLD.status` is locked, resolving, resolved or void,
  reject changes to `contract`, `deadline_at`, `resolution_method`, `lock_at`,
  `locked_source_version`, `locked_source_hash`.
- `claims_status_transition` — BEFORE UPDATE OF status: reject any (old, new) pair not in the
  Lifecycle table; terminal states never change. Code (`src/lifecycle/transitions.ts`) refuses the
  same transitions early for clearer errors; a test asserts the two tables are identical.

**Indexes**: `(status, deadline_at)` due claims; `(status, lock_at) WHERE status='draft'`;
`(status, needs_info_since) WHERE status='needs_info'`; `(author_x_user_id, created_at DESC)`.

## ContractSchema (jsonb, Zod-validated before every write)

```ts
Contract = {
  subject: string,
  criterion: string,                  // the yes/no condition
  deadline_at: ISODateTime,           // UTC; bare date → 23:59:59Z
  source: {
    name: string,                     // issuing body + record
    kind: string,                     // key in source-policy.trusted (for "trusted")
    locator: string,                  // URL of the official record; its domain = "official"
    scope: string,
    entity_id: string,
    absence_is_meaningful: boolean,   // true only for exhaustive official records
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
| run_at | timestamptz | the resolver run that produced this row; the resolution uses the latest run only |
| source_kind | text CHECK (price_feed, web) | |
| basis | text CHECK (record, absence) | `record` = the source shows a result; `absence` = the result is not in a source whose contract marks `absence_is_meaningful`, checked on or after the deadline |
| source_name | text | e.g. `coinbase`, `premierleague.com`, `bbc.co.uk/sport` |
| trust_level | text CHECK (official, trusted, other) | set in code from the **source policy** (below), never by the model |
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

**Trust level** is computed in code by `trustLevel(url, contract, policy)`:
- `official`: price-feed evidence; or the URL's registrable domain equals the domain of the
  contract's own `source.locator` (works for any topic, no list needed); or it is listed as an
  alias of that issuer in the source policy.
- `trusted`: the domain is listed under the contract's `source.kind` in the source policy.
- `other`: anything else. The model's `from_contract_source` flag is ignored for trust.

**Source policy** (`config/source-policy.json`, versioned) only *adds* to that — issuer aliases and
trusted sites per kind; a missing entry never blocks a claim:

```json
{ "version": 1,
  "issuer_aliases": {                 // extra domains of the same issuer as the locator's domain
    "fda.gov":            ["accessdata.fda.gov"],
    "premierleague.com":  ["resources.premierleague.com"] },
  "trusted": {                        // per kind of result
    "football_results": ["bbc.co.uk", "espn.com", "uefa.com"],
    "regulatory":       ["reuters.com", "apnews.com"] } }
```

**Evidence gates** (evaluated in code; model flags are inputs, never the final word):

| Gate | Passes when |
|---|---|
| trusted | `trust_level` is `official` or `trusted` (`other` never counts) |
| quote_found | the model's quote occurs in the fetched page (checked in memory; the quote is then discarded, never stored). Not applicable to `basis = absence` and price feeds |
| in_window | the event date is inside `(lock_at, deadline_at]`. For `basis = absence`: instead, the source was read on or after the deadline and the contract marks it `absence_is_meaningful` |
| final | the result is final, not a projection or preliminary figure |
| independent | not a copy of another evidence row (different origin, not the same wire story) |

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
| deciding_evidence_id | uuid FK evidences null | the evidence that established the outcome: the official item, the first of the agreeing trusted items, or the one the arbiter/human sided with. Required when outcome is hit or miss; null only for VOID |
| arbiter_model_id | text null | |
| policy_version | int | source-policy version used for trust levels |
| arbiter_notes | text null | why the arbiter decided (or why it could not) |
| human_notes | text null | set when a human decides (CLI now, admin panel later) |
| decided_at | timestamptz null | |
| created_at | timestamptz default now() | |

**How the resolution is reached** (from the claim's passed evidences):

Only the latest `run_at` is used. `pending`, `irrelevant` and `entity_gone` items never count as HIT
or MISS. An `official` item saying `pending` (it fails the `final` gate, so `passed = false`, but
this rule reads it anyway) makes the claim wait for the next run; still pending 30 days after the
deadline → `needs_human`.

| Passed evidence | Result |
|---|---|
| 1 or more `official`, none contradicting | final — `decided_by = evidence` |
| no `official`, 2 or more `trusted` agree, none contradicting | final — `decided_by = evidence` |
| they contradict | LLM arbiter reads them (official outweighs trusted): decides → final, `decided_by = arbiter` with notes; can't decide → `needs_human` |
| exactly 1 `trusted`, no `official` | `needs_human` (one non-official source is not enough) |
| none, but sources were checked | final VOID, `insufficient_evidence` |
| an `official` item says `entity_gone` | final VOID, `unresolvable` |

A source that could not be reached writes no evidence; the claim waits for the next run. The claim
moves to `resolved`/`void` only when the resolution is `final`; `needs_human` keeps it in `resolving`
and lists it for the operator (CLI in Stage 0, admin panel later). A human decision updates the row:
`outcome`, `decided_by = human`, `human_notes`, `review_status = final`.

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
re-read once; if its version differs from `source_version`, the claim does not lock and the edit is
handled as an amend (new contract, `[AMENDED]` reply, `lock_at` reset, `amend_count` + 1).

## Not in Stage 0

Mention ingestion state, reply delivery, opt-out and display names (Stage 1).
