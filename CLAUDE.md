@AGENTS.md

<!-- SPECKIT START -->
**Constitution**: `.specify/memory/constitution.md` (v2.6.0) — principles every plan must pass.

**Active plan**: `specs/003-python-platform/plan.md` (001's plan, research, data-model and contracts/ stay the reference for the claim pipeline).

**Active feature**: `specs/003-python-platform/spec.md` — operations, capacity and cost, in three deploy
stages: a private status page over job state and build info; a measured capacity baseline replacing the
UNRECONCILED numbers; a local entailment verifier in front of the paid model, shadow first and behind a
switch. The service layer is Python, which needs the constitution VII amendment first.
Shipped before it: `specs/002-content-feed/spec.md` — the account's own feed: weighted pool reposts, the
owner's queue of own posts; caps and "never twice" in the database, behind
`ENABLE_FEED`/`FEED_DRY_RUN`. And `specs/001-stage0-contract-core/spec.md` — Stage 0, offline: contracts for any
topic, checks CLI over fixtures, NEEDS INFO case A, resolver (crypto deterministic, everything else
model-decided) proven on seeded claims, public pages. Where INIT_SPEC (v1.1.1) is narrower
(deterministic-only, crypto + one league), the constitution and this spec win.
<!-- SPECKIT END -->

## Non-negotiables (from INIT_SPEC — read the section before changing the area)

- **Lock is the trust primitive**: contract fields never change after `lock_at` (§4, §6.6).
- **Checkable by construction** (constitution II): any topic, but every contract names criterion, deadline, source and how "no" is shown. Evidence from several sources must pass code gates; one resolution per claim (agree / LLM arbiter / human review flag). No evidence = VOID, never MISS.
- **Outage ≠ verdict**: source down → retry next run, no void, no `undecided_count` bump (§6.7).
- **One reply per inbound interaction**; never a standalone `@mention` post (§6.1, §6.5).
- **Lease writes are `worker_token`-guarded**; 0 rows updated → no side effects (§6.1).
- **Never retry a post after a failed existence check** — that is how duplicates happen (§6.7).
- **No post text stored**, IDs only (§6.9). `x_user_id` is identity; handle is a display cache (§3).
- **Replies only where mentioned** (constitution VI): one reply per mention, in that thread; no unsolicited replies. The final verdict is posted once in the claim's thread (constitution VI 2.3.0).
- **Own-feed posts** (constitution VI 2.5.0, spec 002): only from `src/content/` — pool reposts and quote posts, owner-written originals. The feed never republishes a verdict: a verdict is told once, in the claim's thread, because a hit or a miss belongs to its author (owner decision 2026-10-07). Capped per day in code, dry-run by default, and text the bot adds carries no @mentions, links or prediction of its own; the only hashtag allowed is the claim's own slug.
- **Infer, never interrogate** (owner decisions 2026-10-04/05): the bot fills in what follows from the
  post, the thread or a public schedule and shows it in the reply, where the author can fix it in 15
  minutes. The platform is X; a date is computed from TODAY ("next month", "in a week"); an event with a
  known schedule IS a deadline ("the next US presidential election" → 2028-11-07). If a date could be
  written into the suggested example, it must be recorded instead. NEEDS INFO is only for what is
  genuinely absent: no measurable outcome, no datable event, or a name the thread never settles. What sits
  above a post on X is not its ancestry: before refusing for missing context, the whole conversation is
  read once, including replies beside the post (owner decision 2026-10-07, `thread_read` spend).
- All timestamps UTC; bare date = `23:59:59 UTC` (§8).

## Conventions

**Commit messages**: one line, `feat|fix|chore|docs(001-T001): <short desc>` — task ID is spec number + task (IDs restart per spec); a commit covering several tasks names the range, `feat(001-T009-024): …`. Omit the task ref when there is no associated task. Never commit without explicit user request.

**PR descriptions**: plain human language, no code identifiers, file paths, line numbers, or test/finding counts. Describe what changed for a person reading it, not what changed in the diff.

**Code comments**: max ~200 chars per comment. State what/why in one line; point to the spec section (`INIT_SPEC §6.7`) or decision doc (`docs/decisions/0NN-*.md`) for rationale — never restate it inline.

**Hack tagging**: code justified by a specific provider/environment quirk (X API, Coinbase, Supabase, Gemini) rather than general correctness must be tagged right above it:

```
// HACK(<scope>): <OBSERVED w/ citation, or SPECULATIVE — say which>. See <doc path>.
// REVISIT: <condition that should trigger re-checking or deleting this>.
```

Before changing a provider or model, `grep -rn "HACK(" src/` and re-validate every hit. Do not keep untagged speculative defensive code as "cheap insurance".

**Unverified numbers stay labelled**: prices, rate limits and API behavior not yet measured (e.g. the §9 summoned-reply rate) are marked UNRECONCILED until measured. A documented number is not a verified one.

**Tests**: ~55% repo-wide coverage is the MVP target and a cap, not a floor — default to NOT adding a test. The exceptions are the gates, the resolver and the mention/posting lifecycle — keep those exhaustive, because the §12 acceptance criteria (60 seeded claims at 100%, crash-window and lease-race tests, 100-example fixture corpus) are the product's proof it can referee.

**Fixtures**: commit the cases (corpus, seeds with expected answers), never recorded model/search/fetch answers — `fixtures/replay/` is gitignored and regenerated with `LLM_MODE=record` (research R5). Tests use stub models, not recordings.
