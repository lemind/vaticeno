# Reply templates (fixed frames; ≤ 280 chars; URL as plain text, no link card)

Only the parts in `{…}` vary. `{statement}` is rendered from the contract, never model prose.

**RECORDED**
```
RECORDED · #{slug}
"{statement}"
Edits accepted for 15 min.
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
  • Reply with a fix (15 min) → updated
  • quote → a quote about bets
  • selfpromo → who I am
  • STOP → I go quiet (tag me to resume)
  • * → nobody knows what to expect :)
  ```
- X rules: `NOT RECORDED — I can't record this one.` (no quote, no explanation)
- duplicate: `ALREADY RECORDED · #{existing_slug}`
- sports match not found scheduled: `NOT RECORDED — I can't find that match scheduled — name both teams and the day.`
- Commands: bare ones (`quote`, `quote 2`, `qoute`) in code; anything unclear is assessed by the model with the
  thread (`intent.v1`). A question gets `{answer}` (≤ 200 chars, no tags or links); otherwise help.
- selfpromo (~50 names and phrases: promote, promote yourself, show off, flex, brag, pitch, who are you…): `{one of 5 mottos}\n\n{AI joke ≤ 140 chars}` (motto alone if the model fails)
- quote: `“{quote}” — {author}, {source}` from Wikiquote; if it can't be fetched, no reply yet: retried after 1, 5, 30 and 120 min, then dropped with an alert
- STOP: `STOPPED — I won't reply to you until you tag me again. Your locked predictions are still checked.`
- someone else's post: `NOT RECORDED — I only record your own predictions. Tag me under your post.`

**RESOLVED** — `HIT · #{slug}` / `MISS · #{slug}` / `VOID · #{slug}`, then the statement, the deciding
answer's proof line (`Coinbase daily close {date}: {value}` or `{result} · {Site}` (e.g. `Browns 24–17 Steelers · NFL`, the site without its domain ending so X makes no link), else `Source: {Site} ({date})`; VOID: `Void: {reason}.`;
human review: `Decided on review.`). Posted once as a reply under the author's summon (constitution VI 2.3.0),
within 7 days of the decision, never to an author who sent STOP; marked before posting, never retried.

Posted only as the one reply to a mention (constitution VI); never stored.
