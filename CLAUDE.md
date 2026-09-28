@AGENTS.md

<!-- SPECKIT START -->
**Active plan**: none yet. Source of truth is `INIT_SPEC.md` (v1.1.1). Build order is INIT_SPEC §14 —
Stage 0 (fully offline: schema, normalizer + gates CLI, deterministic resolver + 60 seeded claims,
public pages) comes first. No code exists yet.
<!-- SPECKIT END -->

## Non-negotiables (from INIT_SPEC — read the section before changing the area)

- **Lock is the trust primitive**: contract fields never change after `locked_at` (§4, §6.6).
- **Deterministic resolution only**; the LLM normalizes, never judges (§6.4, §6.7).
- **Outage ≠ verdict**: source down → retry next run, no void, no `undecided_count` bump (§6.7).
- **One reply per inbound interaction**; never a standalone `@mention` post (§6.1, §6.5).
- **Lease writes are `worker_token`-guarded**; 0 rows updated → no side effects (§6.1).
- **Never retry a post after a failed existence check** — that is how duplicates happen (§6.7).
- **No post text stored**, IDs only (§6.9). `x_user_id` is identity; handle is a display cache (§3).
- **No live X replies before policy approval** (§10). `RESOLUTION_DELIVERY` defaults to `page_only`.
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
