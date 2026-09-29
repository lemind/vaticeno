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

## Search — `search.v1` (grounded, no verdict)

Input: locked contract. Output: grounding metadata only (`webSearchQueries`,
`groundingChunks[].web.uri`) → candidate URLs. The model's prose is ignored.

## Judge — `judge.v1` (no tools)

Input: locked contract, `lock_at`, and the snapshots our code fetched (`[{snapshot_id, url, text}]`).

```ts
JudgeSchema = {                         // one call per snapshot → one evidence row
  says: 'hit' | 'miss' | 'pending' | 'irrelevant' | 'entity_gone',
  basis: 'record' | 'absence',          // absence only when reading the contract's exhaustive source
  snapshot_id: string | null,            // must be one of the given snapshots
  quote: string | null,                  // verbatim from that snapshot; used for the quote gate, never stored
  event_date: string | null,             // YYYY-MM-DD
  is_final_result: boolean,
  from_contract_source: boolean,        // informational only; trust comes from the source policy
  reasoning: string                      // ≤ 400 chars, stored for audit
}
```
Code then runs the gates (trusted, quote_found, in_window, final, independent) and stores the
evidence row with `gates` and `passed`. Model flags (`is_final_result`, `from_contract_source`) are
inputs to the gates, never the final word.

## Arbiter — `arbitrate.v1` (no tools)

Input: locked contract and the contradicting passed evidence rows with their snapshots.

```ts
ArbiterSchema = {
  decision: 'decided' | 'cannot_decide',
  deciding_evidence_id: string | null,   // must be one of the given rows when decided
  outcome: 'hit' | 'miss' | null,        // must match the confirmed evidence
  notes: string                          // ≤ 400 chars, shown on the claim page
}
```
`cannot_decide` → resolution `review_status = needs_human`.
