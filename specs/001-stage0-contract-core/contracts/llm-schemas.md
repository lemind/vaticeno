# Model output contracts (Zod-validated; instructions versioned in `src/llm/instructions/`)

## Proposal — `normalize.v1`

Input: prediction text, today's UTC date. One call + one retry on schema failure.

```ts
ProposalSchema = {
  is_prediction: boolean,
  x_rules_ok: boolean,
  contract: ContractSchema | null,       // data-model.md
  unclear: Array<'deadline' | 'threshold' | 'subject' | 'success_condition' | 'source' | 'ambiguous_event'>,
  unclear_explanation: string,           // ≤ 120 chars, used in NEEDS INFO
  examples: string[],                    // 0–3 amend bodies "<what happens> by <YYYY-MM-DD>"
  self_confidence: number                // recorded only — not a check
}
```

## Search — `search.v2` (grounded, no verdict)

Input: locked contract, lock and deadline, and the pass number (two passes, `JUDGE_MODEL_A` then
`JUDGE_MODEL_B`). Output: grounding metadata only (`webSearchQueries`, `groundingChunks[].web.uri`) →
candidate URLs. The model's prose is ignored. The contract's own locator is always read as well.
Input also lists known sources (`sources.agreed_count ≥ 5`) as places to look first — a hint only.

## Judge — `judge.v3` (no tools; the seeded claims replay with `judge.v2`, which has no `event_start`)

Input: locked contract, lock and deadline, and ONE page our code fetched (`{url, text}`). One call per
page → one evidence row.

```ts
JudgeSchema = {
  says: 'hit' | 'miss' | 'pending' | 'irrelevant' | 'entity_gone',
  basis: 'record' | 'absence',          // absence only when this page is the contract's exhaustive record
  quote: string | null,                  // verbatim from the page; checked in code, then dropped
  event_date: string | null,             // YYYY-MM-DD of the event itself, not of publication
  event_start: string | null,            // UTC date-time the event began (kickoff), only if the page states it
  result: string | null,                 // the outcome in its own words, ≤ 60 chars ("Browns 24–17 Steelers"); shown in the verdict
  is_final_result: boolean,
  from_contract_source: boolean,        // informational only
  source_trust: 'primary' | 'established' | 'weak',  // primary = the body that decides/records the outcome;
                                         // established = outlet with own reporting; weak = anything else
  trust_reason: string,                  // ≤ 200 chars; stored on the evidence row
  original_source: string | null,       // who first reported it if the page credits one (e.g. "AP"); independence gate
  reasoning: string                      // ≤ 400 chars; not stored in the database
}
```
Code caps `source_trust` with `capTrust` (primary only for the contract's own source domain, else
at most established), then runs the gates (trusted, quote_found, in_window, final, independent) and stores the
evidence row with `gates` and `passed`. Model flags (`is_final_result`, `from_contract_source`) are
inputs to the gates, never the final word.

Replay: the key is the contract + the page's URL and sha256 (replay never has page text). The
recorded answer has no `quote` field, only `quote_sha256` and `quote_found` (computed when recorded) —
never the quote itself.

## Arbiter — `arbitrate.v1` (no tools)

Input: locked contract and the contradicting passed evidence items of this run, numbered from 0, each
with its source, trust level, answer, event date and page text (in memory).

```ts
ArbiterSchema = {
  decision: 'decided' | 'cannot_decide',
  deciding_index: number | null,         // one of the given items when decided
  outcome: 'hit' | 'miss' | null,        // must equal that item's answer, or it is treated as cannot_decide
  notes: string                          // ≤ 400 chars, shown on the claim page
}
```
An index (not an evidence id) keeps replay stable: ids are new on every run. `cannot_decide` →
resolution `review_status = needs_human`.

## Fixture check — `fixture.v1` (Google Search; sports claims only)

Input: criterion, subject, deadline, now. Output (JSON read from the answer text):

```ts
{ found: boolean, home: string | null, away: string | null, competition: string | null,
  kickoff_utc: string | null,  // YYYY-MM-DDTHH:MM:SSZ if a source states it
  criterion: string | null }   // rewritten with both sides + competition, ≤ 100 chars
```

Not found → rejected `event_not_found`; kickoff already passed → `deadline_too_close`; a kickoff after the
deadline moves the deadline to the end of the kickoff's UTC day.
