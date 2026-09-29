# Reply templates (fixed frames; ≤ 280 chars; URL as plain text, no link card)

Only the parts in `{…}` vary. `{statement}` is rendered from the contract, never model prose.

**RECORDED**
```
RECORDED · #{slug}

"{statement}"

Source: {source.name}
Locks: {lock_in} · Resolves: shortly after {deadline_date}

Wrong wording? Reply "amend <corrected> by <YYYY-MM-DD>" before lock.
vaticeno.app/c/{slug}
```

**NEEDS INFO** (case A) — `{unclear_explanation}` and examples come from the model and are checked.
```
NOT RECORDED — I can't judge this as written.

{unclear_explanation}

Reply: amend <what happens> by <YYYY-MM-DD>
e.g. amend {example_1}
```
Fallback example when no generated example survives the checks:
`amend BTC daily close above $150,000 by 2026-12-31`.

**AMENDED** — a new reply, never an edit of the earlier one
```
[AMENDED] #{slug}

Now judging:
"{statement}"

Locks: {lock_in} · amends left: {amends_left}
vaticeno.app/c/{slug}
```

**REJECTED**
- not a prediction / deadline out of range: `NOT RECORDED — {reason_in_words}.`
- X rules: `NOT RECORDED — I can't record this one.` (no quote, no explanation)
- duplicate: `ALREADY RECORDED · vaticeno.app/c/{existing_slug}`

**RESOLVED** — `HIT · #{slug}` / `MISS · #{slug}` / `VOID · #{slug}`, then the statement, the deciding
answer's proof line (`{event_date}: {value or source name}`), `Locked {locked_date} · vaticeno.app/c/{slug}`.

In Stage 0 these are produced and checked by the CLI (length, frame), not stored or posted.
