# Data Model: Visibility, settlement and cost

Three changes to the Stage 0 model (`specs/001-stage0-contract-core/data-model.md`): one new table for job
health, one for the verifier's shadow answers, one for a person's confirmation of their outcomes, one for the settlement queue, and two columns on `resolutions`. All timestamps
`timestamptz`, stored UTC. Every enum column carries a CHECK constraint. RLS stays enabled everywhere — see
Access, which is where the read-only role needs more than a grant.

| Table | What it stores | Why |
|---|---|---|
| `job_state` (new) | one row per scheduled job: when it last ran, whether it worked, when it was last late | job health lives in a Node variable today, where no other process can read it |
| `verifier_shadow` (new) | what the fast path would have concluded, next to what the paid model did | shadow answers must never be readable as the decision that was taken |
| `outcome_confirmations` (new) | a person's check of a shadow claim's outcome and its underlying event | the go-live count (SC-005) must rest on outcomes our resolver did not only assert |
| `settlement_outbox` (new) | one row per verdict that has a stake waiting on it | the only interface between the resolver and the process holding the signing key |
| `wallet_links` (new) | which address a person proved they control, and for how long that held | attributing a stake to the author of a claim, without the contract knowing anything about X |
| `resolutions` (+2 columns) | which verifier confirmed a fast-path verdict, and how confident it was | a verdict the paid model reached says so, even when the local model had an opinion |

## `job_state`

| Column | Type | Notes |
|---|---|---|
| job | text PK | the nine names in `SCHEDULES` (`src/jobs/scheduler.ts`), plus `settlement_worker` from Stage 2, whose heartbeat makes a dead worker visible even when the outbox is empty. No CHECK enumerating them: that would duplicate the job list the code owns (SC-002) and need a migration per job. The seeding test asserts the row set equals `SCHEDULES`, and `runJob` only ever updates, so a wrong name writes nothing rather than a bad row |
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

## `recheck_findings`

**One row per claim, not per recheck run.** The weekly recheck re-decides the last seven days; a verdict it
disagrees with must outlive that window, or Monday's finding is gone by the next Monday (spec FR-007a).

| Column | Type | Notes |
|---|---|---|
| claim_id | uuid PK | FK `claims`, one open finding per claim |
| found_at | timestamptz NOT NULL | the first run that disagreed |
| last_seen_at | timestamptz NOT NULL | the most recent run that still disagreed, while the claim is in window |
| published_outcome | text NOT NULL | CHECK `hit \| miss \| void` — what the thread says |
| recheck_outcome | text null | what today's rules reach; null when they settle nothing |
| kind | text NOT NULL | CHECK `differs \| unsettled` |
| cleared_at | timestamptz null | set when a correction answers it, or the owner dismisses it |

**Cleared, never deleted.** A finding that was corrected is the record that the loop closed; the page hides
it and the row stays. Clearing is the only write the recheck makes to a row it did not create.

## `verifier_shadow`

**One row per resolution attempt**, not per evidence item. The endpoint answers about a single passage, but
the comparable unit is what the fast path *would have concluded* for the whole claim — that is what gets
measured against the paid model.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid NOT NULL → claims | |
| resolution_id | uuid null → resolutions | set when the attempt produced a resolution; an attempt that ended waiting has none |
| model | text NOT NULL | the frozen candidate SC-005 counts for, pinned in code: the local model's name and version, the gate's version (threshold and agreement rule), the gates version (which pages pass) and the extractor version; failures are filed under it too, and an answer from another model is refused (`model_mismatch`) |
| would_finalise | boolean NOT NULL | whether the gate would have taken it |
| would_outcome | text null | CHECK `hit \| miss`; null when it would have escalated |
| min_confidence | real null | CHECK between 0 and 1 — the weakest item the gate relied on; null when a call failed, a page came back unscored, or the gate escalated before reading any page |
| paid_outcome | text null | CHECK `hit \| miss \| void`; what the paid model concluded |
| error_tag | text null | the first failed call's tag (`timeout`, `network`, `auth`, `http`, `malformed`, `no_text`, `paused`) or `model_mismatch`; the row still exists, so a silent failure cannot read as a quiet success |
| latency_ms | int null | how long the call took, the other half of whether the fast path is worth having |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Agreement rate = rows where `would_finalise` and `would_outcome = paid_outcome`, over rows where
`would_finalise` **and `paid_outcome` is not null**. An attempt that never reached a paid verdict, or whose
call failed, stays out of the denominator — otherwise a week of timeouts reads as a worse or better model
than it is. A disagreement inside it is the signal the shadow deploy exists to produce.

**Append-only, enforced**: a trigger rejects UPDATE and DELETE, the same way the lock and verdict rules are
enforced in Postgres rather than in code. Deliberately **not** part of `resolutions`: dropping this table
removes the experiment and changes no verdict.

## `outcome_confirmations`

A person's check of a shadow claim's outcome, so SC-005 counts outcomes our resolver did not only
assert. Written through the review commands (`review:confirm`); never read by the resolver. The count itself is
one query, `status/shadow_count.sql`: per candidate, each claim by its latest attempt, each event once, and
an event is wrong if any of its claims is.

| Column | Type | Notes |
|---|---|---|
| claim_id | uuid PK → claims | one confirmation per claim |
| outcome | text NOT NULL | CHECK `hit \| miss \| void`; what the person found |
| event_key | text NOT NULL | the underlying event, owner-written, so claims about one event count once |
| confirmed_at | timestamptz NOT NULL DEFAULT now() | |

## `resolutions` additions

| Column | Type | Notes |
|---|---|---|
| verifier | text null | name and version, set only when the fast path finalised it |
| verifier_confidence | real null | CHECK between 0 and 1 |

`decided_by` keeps its existing values: a fast-path verdict is `evidence` — the evidence decided, the local
model only confirmed it was unambiguous. No new value, no widened constraint. A decider's version already has
a home for the arbiter (`arbiter_model_id`), so nothing is duplicated here.

Null in both means today's behaviour, which is what lets the fast path be switched off with no migration.
With the fast path parked (spec SC-006) both stay null; they are kept so a later design needs no migration.

## `settlement_outbox`

The entire interface between TypeScript and the settlement worker: **one row per locked price-feed claim**,
carrying the claim from authorization to settlement. Node writes the row when the claim locks and sets the
outcome when its verdict is final; the worker signs, settles and writes the results back. Nothing else
touches it.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid NOT NULL UNIQUE → claims | one row per claim: the unique key is what stops a replay creating a second one |
| claim_hash | text null | keccak-256 of the slug, written by the worker — the one place it is computed |
| open_authorization | text null | the oracle's EIP-712 signature letting anyone open a stake on this claim; set once by the worker |
| authorized_until | timestamptz null | when acceptance closes, 24 hours before the deadline; the signature holds until then |
| outcome | text null | CHECK `hit \| miss \| void`; null until the verdict is final, then copied from it, never recomputed |
| state | text NOT NULL | CHECK `open \| pending \| held \| sent \| no_stake \| failed`: `open` until the verdict, `pending` once a second read confirms it, `held` when that read disagrees — nothing settles and the timeout refunds |
| attempts | int NOT NULL DEFAULT 0 | |
| tx_references | text[] NOT NULL DEFAULT '{}' | one per stake settled; a claim can carry several |
| last_error | text null | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| sent_at | timestamptz null | |

A row is written only for a price-feed claim (FR-031a), in the same transaction as the lock, and never gets an
outcome from a verdict the local verifier decided alone. The stake itself lives on-chain, not here: this table
holds no addresses and no amounts, so a leak of the database tells an attacker nothing the chain does not.

**The worker reads the truth, not the row.** It builds every transaction from the claim and its final
resolution, read from their own tables, and stops if the row's outcome disagrees (FR-028a). The row says
*which* claim; the resolution says *what* happened. The evidence reference it puts on-chain is the keccak-256
of the resolution's id.

**No stake is an outcome.** After the verdict the worker asks the contract for every stake on the claim
(`stakesOf`), settles each matched one, and ends the row `no_stake` when there was none.

Idempotency is enforced in three places, the same shape as never retrying a post after a failed existence
check (INIT_SPEC §6.7): the worker reads each stake's on-chain state before sending, the contract rejects a
second settlement, and the unique key here allows one row per claim.

## `wager_replies`

What makes "one link per claim" (FR-038) hold across restarts. The row is inserted **before** the reply is
sent, under the unique key; an insert that conflicts means the link was already spent, and the mention gets
no reply. The reply then goes out as every reply does: marked answered before the post, never retried
(INIT_SPEC §6.7). This is at most once, on purpose: a crash between the insert and the post loses that
claim's link rather than risk a second one. The mention job runs one at a time under its job lock, so the
daily count and the insert cannot race.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| claim_id | uuid NOT NULL → claims | |
| kind | text NOT NULL | CHECK `link \| not_locked \| not_price \| closed`; UNIQUE (claim_id, kind): one link, and one refusal per reason |
| mention_id | text NOT NULL | the X post id the reply answered; ids only (V) |
| created_at | timestamptz NOT NULL DEFAULT now() | |

A `not_locked` row does not block the later `link` row, which is the point of keeping the kinds apart. The
daily cap counts today's `link` rows (UTC); refusals count only against the existing reply caps.

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
| revoked_by | text null | CHECK `account` or `wallet`: which half ended it (FR-035d) |

**Rules.** An address has at most one *active* link at a time — a partial unique index on `address` where
`revoked_at is null` — or one wallet could claim several identities. An x_user_id may hold several active
addresses, because people have several wallets. Revoking sets `revoked_at`; re-linking later writes a new row,
so every link keeps its validity period and a stake placed last year still resolves to whoever was linked
*then*: a stake counts only under a link active when it was placed (FR-035e).

## `wallet_link_challenges`

The code in the link flow cannot live in memory: a restart between the reply and the signature would either
lose the flow or let a used code be replayed. Each state change is a conditional update on the state before
it (`bound_at is null`, then `consumed_at is null`), so two polls reading the same post bind once.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code_hash | text NOT NULL UNIQUE | the code itself is never stored, only its hash |
| x_user_id | text NOT NULL | the account named on the page, resolved to its numeric id **before** the code is issued; a post from anyone else binds nothing (FR-035) |
| session_hash | text NOT NULL | binds the browser that asked for it, so another tab cannot finish the flow |
| expires_at | timestamptz NOT NULL | an expired code is refused, never refreshed; the TTL is UNRECONCILED (FR-035b) |
| bound_at | timestamptz null | `issued → bound`: the matching post arrived inside the window |
| foreign_attempts | int NOT NULL DEFAULT 0 | posts of this code by other accounts: counted, never binding (SC-016) |
| consumed_at | timestamptz null | `bound → completed`: the signature checked; single use, enforced here rather than by deleting the row |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Neither this table nor `wallet_links` gets a `status_ro` policy: an X account tied to an address is the one
piece of this feature worth protecting, and the status page has no use for it.

**The contract never sees any of this.** It knows two addresses and a claim hash. Authorship is checked
off-chain, where it can be changed without a redeployment.

## Access

```
Node service      → owner role → read/write everything (unchanged)
status service    → status_ro   → SELECT only
settlement worker → settle_rw   → settlement_outbox: SELECT + UPDATE; claims, resolutions: SELECT; no INSERT
verifier          → no database at all
```

`status_ro` is created by its migration **without a login**, so a fresh local database applies the policies
that name it; its password is set by hand on Supabase and never reaches git (`deploy/status-role.md`).
`settle_rw` is created by hand the same way when Stage 2 ships. "Owner role, this table only" is not a restriction at all — the owner
bypasses RLS — so the worker gets its own role with SELECT and UPDATE on `settlement_outbox`, SELECT on
`claims` and `resolutions` so it can build from the verdict itself (FR-028a), and no INSERT anywhere: the Node
service writes the row, the worker signs, sends and writes the result back.

**One name for one wager.** The worker settles by `claim_id` → the claim's slug hash, which is the
`claimHash` the contract was opened with. That mapping is computed in one place and nowhere else, so the
worker cannot settle a wager other than the one its row names.

**A grant alone is not enough.** RLS is enabled with no policies on every table (`drizzle/0002_rls.sql`), and
that is what keeps Supabase's public API from seeing anything. The owner role bypasses RLS; `status_ro` does
not, so without a policy it reads zero rows from every table and the page renders empty. Each table the page
reads therefore gets one policy — `FOR SELECT TO status_ro USING (true)` — alongside the grant: `job_state`,
`recheck_findings`, `claims`, `resolutions`, `cost_events`, `feed_posts` and `settlement_outbox` from Stage 2 — never
`wallet_links` or `wallet_link_challenges` — and `verifier_shadow` and `outcome_confirmations` from Stage 3. The anon and
authenticated roles stay with no policy at all, so the public API still sees nothing.

## Migrations

| File | Adds |
|---|---|
| `drizzle/0017_job_state.sql` | `job_state`, RLS on, the `status_ro` SELECT policy, a down migration |
| `drizzle/0018_recheck_findings.sql` | `recheck_findings`, RLS on, its `status_ro` SELECT policy |
| `drizzle/0019_status_policies.sql` | SELECT policies for `status_ro` on the existing tables the page reads |
| `drizzle/0020_settlement.sql` | `settlement_outbox` (one row per locked price claim), the `settle_rw` role's policies, its unique key |
| `drizzle/0021_wager_replies.sql` | `wager_replies` with its unique key and CHECK, RLS on with no policy |
| `drizzle/0022_verifier.sql` | `verifier_shadow` with its append-only trigger and policy, `outcome_confirmations` with RLS and its `status_ro` policy, the two `resolutions` columns |
| `drizzle/0023_wallet_links.sql` | `wallet_links` and `wallet_link_challenges`, the partial unique index on an active address |

Numbered in deploy order, not in the order the tables were designed: Stage 2 ships before Stage 3, so the
settlement migrations come first and the verifier's cannot be dragged in by a Stage 2 deployment. The
verifier's took 0022 when it shipped before the optional wallet links (2026-10-25).
