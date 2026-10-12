# Data Model: Visibility, settlement and cost

Three changes to the Stage 0 model (`specs/001-stage0-contract-core/data-model.md`): one new table for job
health, one for the verifier's shadow answers, one for the settlement queue, and two columns on `resolutions`. All timestamps
`timestamptz`, stored UTC. Every enum column carries a CHECK constraint. RLS stays enabled everywhere — see
Access, which is where the read-only role needs more than a grant.

| Table | What it stores | Why |
|---|---|---|
| `job_state` (new) | one row per scheduled job: when it last ran, whether it worked, when it was last late | job health lives in a Node variable today, where no other process can read it |
| `verifier_shadow` (new) | what the fast path would have concluded, next to what the paid model did | shadow answers must never be readable as the decision that was taken |
| `settlement_outbox` (new) | one row per verdict that has a stake waiting on it | the only interface between the resolver and the process holding the signing key |
| `wallet_links` (new) | which address a person proved they control, and for how long that held | attributing a stake to the author of a claim, without the contract knowing anything about X |
| `resolutions` (+2 columns) | which verifier confirmed a fast-path verdict, and how confident it was | a verdict the paid model reached says so, even when the local model had an opinion |

## `job_state`

| Column | Type | Notes |
|---|---|---|
| job | text PK | CHECK against `SCHEDULES` in `src/jobs/scheduler.ts` — nine as of 2026-10-12: mentions, lock, expire, resolve, verdicts, pool, original, reconcile, recheck — plus `settlement_worker`, whose heartbeat makes a dead worker visible even when the outbox is empty |
| last_started_at | timestamptz null | set when `runJob` enters |
| last_finished_at | timestamptz null | set when it returns, either way |
| last_ok_at | timestamptz null | last successful finish |
| last_outcome | text null | CHECK `ok \| failed` |
| last_error_tag | text null | the tag already sent to Sentry |
| last_locked_at | timestamptz null | a run skipped because another held the advisory lock |
| consecutive_failures | int NOT NULL DEFAULT 0 | reset by a success |
| stale_after_seconds | int NOT NULL | how long this job may go without running before it is late |

**A lock skip is not an outcome.** The lock is normally held by a run that is working — a manual `jobs:tick`
beside the cron tick — so it writes `last_locked_at` and touches nothing else. Writing an outcome there would
report a healthy job as broken.

**Staleness**: `stale_after_seconds = interval × 2 + 60`, floored at 120. The code beside `SCHEDULES` is the
single source of truth and overwrites the column on every startup, so changing a schedule cannot leave an old
window behind. Rows are seeded at startup, so a job that has never run reads as never-run, not as absent.

**One row per job, not per run.** Two jobs run every minute; a row per run is about a million rows a year and
a retention sweep to own. One row answers every question the page asks, and failure history already lives in
Sentry.

## `verifier_shadow`

**One row per resolution attempt**, not per evidence item. The endpoint answers about a single passage, but
the comparable unit is what the fast path *would have concluded* for the whole claim — that is what gets
measured against the paid model.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid NOT NULL → claims | |
| resolution_id | uuid null → resolutions | set when the attempt produced a resolution; an attempt that ended waiting has none |
| model | text NOT NULL | name and version of the local model |
| would_finalise | boolean NOT NULL | whether the gate would have taken it |
| would_outcome | text null | CHECK `hit \| miss`; null when it would have escalated |
| min_confidence | real null | CHECK between 0 and 1 — the weakest item the gate relied on; null when the call failed |
| paid_outcome | text null | CHECK `hit \| miss \| void`; what the paid model concluded |
| error_tag | text null | set when the call timed out or came back malformed; the row still exists, so a silent failure cannot read as a quiet success |
| latency_ms | int null | how long the call took, the other half of whether the fast path is worth having |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Agreement rate = rows where `would_finalise` and `would_outcome = paid_outcome`, over rows where
`would_finalise` **and `paid_outcome` is not null**. An attempt that never reached a paid verdict, or whose
call failed, stays out of the denominator — otherwise a week of timeouts reads as a worse or better model
than it is. A disagreement inside it is the signal the shadow deploy exists to produce.

**Append-only, enforced**: a trigger rejects UPDATE and DELETE, the same way the lock and verdict rules are
enforced in Postgres rather than in code. Deliberately **not** part of `resolutions`: dropping this table
removes the experiment and changes no verdict.

## `resolutions` additions

| Column | Type | Notes |
|---|---|---|
| verifier | text null | name and version, set only when the fast path finalised it |
| verifier_confidence | real null | CHECK between 0 and 1 |

`decided_by` keeps its existing values: a fast-path verdict is `evidence` — the evidence decided, the local
model only confirmed it was unambiguous. No new value, no widened constraint. A decider's version already has
a home for the arbiter (`arbiter_model_id`), so nothing is duplicated here.

Null in both means today's behaviour, which is what lets the fast path be switched off with no migration.

## `settlement_outbox`

The entire interface between TypeScript and the settlement worker. The resolver writes; the worker reads,
sends, and writes back. Nothing else touches it.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid NOT NULL UNIQUE → claims | one row per claim: the unique key is what stops a replay creating a second payout |
| outcome | text NOT NULL | CHECK `hit \| miss \| void` — copied from the final resolution, never recomputed |
| state | text NOT NULL | CHECK `pending \| sent \| failed` |
| attempts | int NOT NULL DEFAULT 0 | |
| tx_reference | text null | set once the transaction is accepted |
| last_error | text null | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| sent_at | timestamptz null | |

A row is written only when the verdict is final **and** a stake exists on that claim, and never for a verdict
the local verifier decided alone. The stake itself lives on-chain, not here: this table holds no addresses and
no amounts, so a leak of the database tells an attacker nothing it could not read from the chain anyway.

Idempotency is enforced in two places, the same shape as never retrying a post after a failed existence check
(INIT_SPEC §6.7): the worker reads the contract's state before sending, and the contract rejects a second
settlement. The unique key here is the third.

## `wallet_links`

Off-chain and **optional**: a stake works without one. It exists only to say "this address belongs to the
person who made the claim", for the cases where that is worth showing.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| x_user_id | text NOT NULL | the immutable numeric id, never the handle (INIT_SPEC §3) |
| wallet_family | text NOT NULL | CHECK `evm` for now; a second family is a second verification path, not a column value |
| address | text NOT NULL | checksummed for display; compared and made unique on its lower-case form, so one wallet cannot hold two identities by case alone |
| verified_at | timestamptz NOT NULL | when the signature checked out |
| revoked_at | timestamptz null | when the link ended; the row is never deleted |

**Rules.** An address has at most one *active* link at a time — a partial unique index on `address` where
`revoked_at is null` — or one wallet could claim several identities. An x_user_id may hold several active
addresses, because people have several wallets. Revoking sets `revoked_at`; re-linking later writes a new row,
so every link keeps its validity period and a stake placed last year still resolves to whoever was linked
*then*.

## `wallet_link_challenges`

The code in the link flow cannot live in memory: a restart between the reply and the signature would either
lose the flow or let a used code be replayed.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code_hash | text NOT NULL UNIQUE | the code itself is never stored, only its hash |
| x_user_id | text null | set when a reply binds the code to an account; null until then |
| session_hash | text null | binds the browser that asked for it, so another tab cannot finish the flow |
| expires_at | timestamptz NOT NULL | short-lived; an expired code is refused, never refreshed |
| consumed_at | timestamptz null | single use, enforced here rather than by deleting the row |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Neither this table nor `wallet_links` gets a `status_ro` policy: an X account tied to an address is the one
piece of this feature worth protecting, and the status page has no use for it.

**The contract never sees any of this.** It knows two addresses and a claim hash. Authorship is checked
off-chain, where it can be changed without a redeployment.

## Access

```
Node service      → owner role → read/write everything (unchanged)
status service    → status_ro   → SELECT only
settlement worker → settle_rw   → settlement_outbox: SELECT + UPDATE, no INSERT, nothing else
verifier          → no database at all
```

`status_ro` and `settle_rw` are created once by hand on Supabase (roles are cluster-level and need a
password, which must not reach git). "Owner role, this table only" is not a restriction at all — the owner
bypasses RLS — so the worker gets its own role with SELECT and UPDATE on `settlement_outbox` and no INSERT:
the Node service writes the row, the worker sends it and writes the result back.

**One name for one wager.** The worker settles by `claim_id` → the claim's slug hash, which is the
`claimHash` the contract was opened with. That mapping is computed in one place and nowhere else, so the
worker cannot settle a wager other than the one its row names.

**A grant alone is not enough.** RLS is enabled with no policies on every table (`drizzle/0002_rls.sql`), and
that is what keeps Supabase's public API from seeing anything. The owner role bypasses RLS; `status_ro` does
not, so without a policy it reads zero rows from every table and the page renders empty. Each table the page
reads therefore gets one policy — `FOR SELECT TO status_ro USING (true)` — alongside the grant: `job_state`,
`claims`, `resolutions`, `cost_events`, `feed_posts` and `settlement_outbox` from Stage 2 — never
`wallet_links` or `wallet_link_challenges` — and `verifier_shadow` from Stage 3. The anon and
authenticated roles stay with no policy at all, so the public API still sees nothing.

## Migrations

| File | Adds |
|---|---|
| `drizzle/0017_job_state.sql` | `job_state`, RLS on, the `status_ro` SELECT policy, a down migration |
| `drizzle/0018_status_policies.sql` | SELECT policies for `status_ro` on the existing tables the page reads |
| `drizzle/0019_settlement.sql` | `settlement_outbox`, the `settle_rw` role's policies, its unique key |
| `drizzle/0020_wallet_links.sql` | `wallet_links` and `wallet_link_challenges`, the partial unique index on an active address |
| `drizzle/0021_verifier.sql` | `verifier_shadow` with its append-only trigger and policy, the two `resolutions` columns |

Numbered in deploy order, not in the order the tables were designed: Stage 2 ships before Stage 3, so the
settlement migrations come first and the verifier's cannot be dragged in by a Stage 2 deployment.
