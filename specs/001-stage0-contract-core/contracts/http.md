# HTTP contract

Server-rendered HTML, no client JS, times in UTC, no post text anywhere (FR-029). Public, read-only.
There is **no admin surface**: operator actions are CLI-only in Stage 0.

### `GET /c/:slug` → 200 HTML | 404
Rendered statement; criterion; source (name, locator link, scope, entity); negative condition;
status; created / lock / resolve times; deadline + countdown ("resolves shortly after …"); each
evidence item (source name, trust level, what it says, link, value, event date, retrieved at, gates); the arbiter's reason
when there was one; the final verdict and which answer decided it; link to the original post
(`https://x.com/i/status/<source_tweet_id>`); positions (MVP: the author).

### `GET /u/:x_user_id` → 200 HTML | 404
Claims the person holds a position on (statement, stance, status, deadline, verdict, derived result)
and raw counts `recorded / resolved / right / wrong / void`. No percentage, ranking or comparison.

### `GET /healthz` → 200 JSON
`{ ok, db, claims_due, oldest_due_age_min, last_resolver_run_at }`
