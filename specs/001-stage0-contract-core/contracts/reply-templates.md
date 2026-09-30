# Reply templates (fixed frames; ≤ 280 chars; URL as plain text, no link card)

Only the parts in `{…}` vary. `{statement}` is rendered from the contract, never model prose.

**RECORDED**
```
RECORDED · #{slug}
"{statement}"
Fix in 15 min: reply with the corrected prediction
vaticeno.app/c/{slug}
```
The statement already names the deadline and, for model claims, the source; the page shows the rest.
Budget: the frame is ~100 weighted chars (X counts any link as 23), so the statement gets ~180 —
hence `criterion` ≤ 100 and `source.name` ≤ 48 in the contract schema.

**NEEDS INFO** (case A) — `{unclear_explanation}` and examples come from the model and are checked.
```
NOT RECORDED — I can't judge this as written.

{unclear_explanation}

Reply with the prediction and a date, e.g.
{example_1}
```
Fallback example when no generated example survives the checks:
`BTC daily close above $150,000 by <next year>-12-31`.

No command word anywhere: any reply from the author under a bot reply is the corrected prediction
(an amend). Replies from anyone else are ignored.

**AMENDED** — a new reply, never an edit of the earlier one
```
[AMENDED] #{slug}

Now judging:
"{statement}"

Locks in 15 min · fixes left: {amends_left}
vaticeno.app/c/{slug}
```

**EXPIRED** — the original post was edited before lock and the edit fails the checks or exceeds the amend limit
```
[EXPIRED] #{slug} — the post changed after recording, so nothing was locked. Tag me on a new post to record it.
```

**NOT CHANGED** — a fix to a recorded (draft) claim that can't be applied; the recorded version stands
```
NOT CHANGED — {reason or unclear_explanation}
#{slug} stays as recorded.
```

**REJECTED**
- deadline out of range: `NOT RECORDED — {reason_in_words}.`
- not a prediction (e.g. "@vaticeno cancel"): the help reply, same as `@vaticeno help` (no model call for
  `help`) — no other commands exist yet
  ```
  I record predictions and check them at the deadline.
  • Tag me under your prediction → recorded
  • Reply with a fix (within 15 min) → updated
  ```
- X rules: `NOT RECORDED — I can't record this one.` (no quote, no explanation)
- duplicate: `ALREADY RECORDED · vaticeno.app/c/{existing_slug}`

**RESOLVED** — `HIT · #{slug}` / `MISS · #{slug}` / `VOID · #{slug}`, then the statement, the deciding
answer's proof line (`{event_date}: {value or source name}`), `Locked {locked_date} · vaticeno.app/c/{slug}`.

In Stage 0 these are produced and checked by the CLI (length, frame), not stored or posted.
