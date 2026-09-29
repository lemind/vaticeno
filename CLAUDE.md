@AGENTS.md

<!-- SPECKIT START -->
**Constitution**: `.specify/memory/constitution.md` (v1.0.0) — principles every plan must pass.

**Active plan**: `specs/001-stage0-contract-core/plan.md` (research, data-model, contracts/, quickstart alongside).

**Active feature**: `specs/001-stage0-contract-core/spec.md` — Stage 0, offline: contracts for any
topic, checks CLI over fixtures, NEEDS INFO case A, resolver (crypto deterministic, everything else
model-decided) proven on seeded claims, public pages. Where INIT_SPEC (v1.1.1) is narrower
(deterministic-only, crypto + one league), the constitution and this spec win.
<!-- SPECKIT END -->

## Non-negotiables (from INIT_SPEC — read the section before changing the area)

- **Lock is the trust primitive**: contract fields never change after `locked_at` (§4, §6.6).
- **Checkable by construction** (constitution II): any topic, but every contract names criterion, deadline, source and how "no" is shown. Evidence from several sources must pass code gates; one resolution per claim (agree / LLM arbiter / human review flag). No evidence = VOID, never MISS.
- **Outage ≠ verdict**: source down → retry next run, no void, no `undecided_count` bump (§6.7).
- **One reply per inbound interaction**; never a standalone `@mention` post (§6.1, §6.5).
- **Lease writes are `worker_token`-guarded**; 0 rows updated → no side effects (§6.1).
- **Never retry a post after a failed existence check** — that is how duplicates happen (§6.7).
- **No post text stored**, IDs only (§6.9). `x_user_id` is identity; handle is a display cache (§3).
- **No live X replies before policy approval** (§10) — sole exception: the POC `ping` → `pong`. `RESOLUTION_DELIVERY` defaults to `page_only`.
- All timestamps UTC; bare date = `23:59:59 UTC` (§8).

## Conventions

**Commit messages**: one line, `feat|fix|chore|docs(001-T001): <short desc>` — task ID is spec number + task (IDs restart per spec). Omit the task ref when there is no associated task. Never commit without explicit user request.

**PR descriptions**: plain human language, no code identifiers, file paths, line numbers, or test/finding counts. Describe what changed for a person reading it, not what changed in the diff.

**Code comments**: max ~200 chars per comment. State what/why in one line; point to the spec section (`INIT_SPEC §6.7`) or decision doc (`docs/decisions/0NN-*.md`) for rationale — never restate it inline.

**Hack tagging**: code justified by a specific provider/environment quirk (X API, CoinGecko, sports API, Gemini) rather than general correctness must be tagged right above it:

```
// HACK(<scope>): <OBSERVED w/ citation, or SPECULATIVE — say which>. See <doc path>.
// REVISIT: <condition that should trigger re-checking or deleting this>.
```

Before changing a provider or model, `grep -rn "HACK(" src/` and re-validate every hit. Do not keep untagged speculative defensive code as "cheap insurance".

**Unverified numbers stay labelled**: prices, rate limits and API behavior not yet measured (e.g. the §9 summoned-reply rate) are marked UNRECONCILED until measured. A documented number is not a verified one.

**Tests**: ~60% repo-wide coverage is a cap, not a floor. The exceptions are the gates, the resolver and the mention/posting lifecycle — keep those exhaustive, because the §12 acceptance criteria (60 seeded claims at 100%, crash-window and lease-race tests, 100-example fixture corpus) are the product's proof it can referee.
