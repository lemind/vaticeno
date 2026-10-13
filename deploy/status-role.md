# The status page's database role

The status service reads the database and does nothing else: no writes, no external calls, no admin
action (003 FR-003). It connects as `status_ro`, which is a different role from the one the bot uses.

The migrations create the role without a login and grant it `SELECT` on the tables the page reads
(`drizzle/0017_job_state.sql`, `0018_recheck_findings.sql`, `0019_status_policies.sql`). Giving it a
password is a manual step, because a password must never reach git.

## Once, on Supabase

Run this in the SQL editor, with a password generated locally:

```sql
ALTER ROLE status_ro WITH LOGIN PASSWORD '<generated>';
```

Then put the connection string in the server's `.env` as `DATABASE_URL_RO`, pointing at the **session**
pooler like `DATABASE_URL` does — the transaction pooler rejects prepared statements (001 research R1).

## Why a second role at all

The owner role bypasses row-level security, so "the owner role, but only this table" is not a restriction
at all (review 2026-10-12). `status_ro` does not bypass it, which is why each table the page reads needs
both a grant and a policy. A table with neither reads as empty rather than as an error, so a missing
policy shows up as a blank block on the page, not as a crash.

## Checking it

As `status_ro`, this must return rows:

```sql
SELECT job, last_ok_at, stale_after_seconds FROM job_state;
```

and this must fail:

```sql
UPDATE job_state SET consecutive_failures = 0;
```
