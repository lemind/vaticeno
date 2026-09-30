# Reply templates (fixed frames; ≤ 280 chars; URL as plain text, no link card)

Only the parts in `{…}` vary. `{statement}` is rendered from the contract, never model prose.

**RECORDED**
```
RECORDED · #{slug}
"{statement}"
Fix in 15 min: reply with the corrected prediction
```
The statement is the criterion plus the deadline (if the criterion lacks it); no source — the resolver picks the sources.
Budget: the frame is ~80 chars (no link: there is no public site yet), so the statement gets ~180 —
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

**STILL NOT RECORDED** — a fix to a needs-info claim that still can't be recorded (24 h clock keeps running)
```
STILL NOT RECORDED — {reason or unclear_explanation}
Reply with the prediction and a date.
```

**REFUSED** — a fix that can't be considered at all (fixed texts, `refusedReply`)
- locked or later: `#{slug} is locked and can't change.` · expired/rejected: `#{slug} can no longer be changed.`
- needs info past 24 h: `#{slug} expired: no fix within 24 hours.`
- two fixes used: `#{slug} can't be changed again (2 fixes used).`
- lost a race with another change: `#{slug} changed meanwhile; nothing was changed.`

**REJECTED**
- deadline out of range: `NOT RECORDED — {reason_in_words}.`
- not a prediction (e.g. "@vaticeno cancel"): the help reply, same as `@vaticeno help` (no model call for
  `help`) — no other commands exist yet
  ```
  I record predictions and check them at the deadline.
  • Tag me under your prediction → recorded
  • Reply with a fix (within 15 min) → updated
  • STOP → I never reply to you again
  ```
- X rules: `NOT RECORDED — I can't record this one.` (no quote, no explanation)
- duplicate: `ALREADY RECORDED · #{existing_slug}`
- STOP: `STOPPED — I won't reply to you again. Your locked predictions are still checked.` (then silence for that author)
- someone else's post: `NOT RECORDED — I only record your own predictions. Tag me under your post.`

**RESOLVED** — `HIT · #{slug}` / `MISS · #{slug}` / `VOID · #{slug}`, then the statement, the deciding
answer's proof line (`{event_date}: {value or source name}`), `Locked {locked_date}`. Not posted: verdicts go to the page only (`RESOLUTION_DELIVERY=page_only`).

Posted only as the one reply to a mention (constitution VI); never stored.
