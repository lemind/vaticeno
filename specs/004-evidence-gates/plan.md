# Implementation Plan: The gates decide on the right event

**Spec**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md) · **Reference**: 001's
[plan](../001-stage0-contract-core/plan.md), [data-model](../001-stage0-contract-core/data-model.md) and
`contracts/` stay the reference for the claim pipeline.

## Summary

Four changes to the resolver's evidence path, no new components. The judge reports which event its page is
about; code decides whether that is the contract's event. Independence moves out of the per-page gate and
becomes grouping after judging, so the order pages were judged in cannot pick the winner. Absence is
admitted only from endpoints recorded in code. Where a page states a structured outcome, code applies the
criterion instead of trusting the judge's own verdict.

## Technical Context

**Stack**: unchanged — TypeScript, Node 22, Postgres, Drizzle. No new dependency.

**Model**: one judging call per page, as today (`judge.v5` replaces `judge.v4`). Rows judged under earlier
versions keep their shape and are read as before.

**Scale**: tens of claims a week, four to seven candidate pages each; grouping is in-memory over that set.

**Constraints**:

- a locked contract is immutable, so the event key is derived from `source.entity_id` and the criterion —
  no schema change (spec FR-012);
- no extra model call and no second judging pass (FR-013);
- no page text stored, only identifiers and fingerprints (INIT_SPEC §6.9);
- a source outage is never a verdict (INIT_SPEC §6.7).

## Constitution Check

| Principle | How this complies |
|---|---|
| II — Checkable by construction | Strengthens it: evidence must now be about the event the contract names before it can count. |
| III — The model describes, code decides | This is the point of the feature. Identity and outcome are reported; matching and the verdict are computed. |
| IV — Trust over growth | More cases escalate to the arbiter or a human rather than publishing a guess. |
| VII — Boring by design | Pure functions in the existing resolver; no new service, store or dependency. |

No deviation to record in Complexity Tracking.

## Architecture

```
search (unchanged)
  ↓  candidate URLs
fetch + judge each page            judge.v5: identity, outcome, result, trust
  ↓  one draft per page
per-page gates                     trusted · quote_found · in_window · final · relevant · consistent
  ↓  survivors only
group                              same site · near-duplicate · same credited origin      ← was a gate
  ↓  one representative per group
decide                             records before absences, unchanged; within-source conflict → arbiter
```

The two moved boundaries: `independent` leaves `runGates` (it was the only gate that read other pages), and
the verdict for a page with a structured outcome is computed in `decide`'s input rather than taken from the
judge.

## Files

| File | Change |
|---|---|
| `src/llm/instructions/judge.v5.md` | new: event identity, finality redefined, result unchanged |
| `src/llm/judges.ts` | `JUDGE_VERSION`, the v5 schema, v4 and earlier read as before |
| `src/resolve/gates.ts` | `relevant` gate; `independent` left unassessed and `sameStory` moved to groups.ts; absence admission tightened |
| `src/resolve/relevance.ts` | new, pure: the contract's event key, and match yes/no/unknown |
| `src/resolve/groups.ts` | new, pure: grouping and representative choice |
| `src/resolve/exhaustive.ts` | new: the configured endpoints that may carry absence evidence |
| `src/resolve/web-evidence.ts` | judge all, gate all, then group; stores identity and match |
| `src/resolve/decide.ts` | unchanged rule, one log line when an admitted absence disagrees with a record |
| `src/resolve/consistency.ts` | new, pure: the criterion applied to a page's own stated outcome |
| `src/resolve/exhaustive.ts` | new: the endpoints that may carry absence evidence, empty today |
| `src/resolve/recheck.ts` + `src/cli/verdict-recheck.ts` | `--rejudge`: fetch and judge again, for a judging error a free recheck cannot see |
| `src/db/schema.ts` + `drizzle/0016_evidence_identity.sql` | identity and match on the evidence row |

## Data model

Two nullable columns on `evidences`, the table 001's data model defines. Nullable because rows judged under
`judge.v4` and earlier carry neither, and nothing rewrites them.

| Column | Type | Notes |
|---|---|---|
| `event_identity` | jsonb null | what the page said about which event it describes: date, and whatever of competition, round or race number, venue and participants it stated. The page's words as fields, never a conclusion |
| `event_match` | text null | CHECK `yes \| no \| unknown \| not_applicable` — what code concluded comparing that identity with the contract's event key. `no` and `unknown` fail the `relevant` gate; `not_applicable` (the contract names nothing comparable) passes it |

The gate results go in the existing `gates` jsonb as `relevant` and `consistent`, like the others, so the
claim page shows them with no schema change (001 FR-027).

Migration `drizzle/0016_evidence_identity.sql` — the next number free on disk, which is what this feature
deploys. 002's Phase 8 and 003 reserved 0016–0021 on paper while this did not exist; those reservations move
up by one when either ships, since numbering follows deploy order (003's own review, 2026-10-12).

## Phases

1. **Identity** — judge.v5, the relevance gate, the pure matcher, the migration. Ends with the Race 1 page
   unable to decide a Race 2 claim.
2. **Grouping** — independence out of the per-page gate, groups and representatives, order-independence
   proved by test.
3. **Absence and consistency** — the configured endpoint list, the quote waiver removed, the records-outrank
   rule left alone and its disagreements logged, facts-versus-verdict check.
4. **The standing verdict** — re-judge the one claim still published wrong and correct it.

Each phase is shippable on its own: phase 1 alone would have prevented the horse-racing verdict, and phase 2
alone would have let the right page be seen.

## Testing

Exhaustive on the gates and the resolver, per 001's convention. The three real failures become fixtures
built from the stored rows, including both pages of the racing meeting — the corpus keeps the cases, never
the recorded answers (research R5). One test judges a candidate set in reverse order and expects the same
verdict.

## Open items carried to tasks

- Which endpoints go on the exhaustive list at launch. Starting with none is acceptable and safe; the first
  entry should be the one the owner can confirm is complete for a whole competition.
- Whether a page that matches on date but says nothing about the round counts as unknown or as no match.
  Treated as unknown (fails closed) until the corpus shows it costs real verdicts.
