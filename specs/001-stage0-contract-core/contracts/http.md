# HTTP contract

Server-rendered HTML, no client JS except the wager page's one script (003 FR-045), times in UTC, no
post text anywhere (FR-029). Public, read-only. There is **no admin surface**: operator actions are CLI-only.

### `GET /claim/:slug` → 200 HTML | 404
Moved from `/c/:slug` (003 FR-040), which now answers **308** to it. Price-feed claims link their wager page.
404 when the claim has no contract (needs info, rejected). Draft, locked, resolving, resolved, void
and expired-with-contract render (expired shows "never locked, not judged").
Rendered statement; criterion; source (name, locator link, scope, entity); negative condition;
status; created / lock / resolve times; deadline + countdown ("resolves shortly after …"); each
evidence item (source name, trust level, what it says, link, value, event date, retrieved at, gates); the arbiter's reason
when there was one; the final verdict and which answer decided it; link to the original post
(`https://x.com/i/status/<source_tweet_id>`); positions (MVP: the author).

### `GET /claim/:slug/wager` → 200 HTML | 404 (003 Story 5)
`Cache-Control: no-store`. The terms (rule, deadline, wagering close, offer expiry, payout hold, timeout),
Vaticeno's verdict and its settlement state, and `wager-data` JSON for the script: escrow, token, chain,
public RPC, claim hash, deadline and — only while acceptance is open — the open authorization. The wagers
themselves are read from the chain in the browser. A model-judged claim gets the page without controls.

### `GET /assets/wallet.js`, `GET /assets/wallet-abi.js` → 200 JavaScript
The wager page's script and its hand-written encoder (003 FR-045, T371a).

### `GET /u/:x_user_id` → 200 HTML | 404
Claims the person holds a position on (statement, stance, status, deadline, verdict, derived result)
and raw counts `recorded / resolved / right / wrong / void` (recorded = claims that reached `locked`). No percentage, ranking or comparison.

### `GET /healthz` → 200 JSON
`{ ok, db, claims_due, oldest_due_age_min, needs_human, last_resolver_run_at }` —
`last_resolver_run_at` is kept in process memory (one process); 503 when the DB is unreachable.
Polled by an external uptime check.
