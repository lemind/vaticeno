# The server

Everything the server runs is in this repo, except the secrets. Moving to a new server is three commands and a DNS change.

## What runs

| What | Unit | When |
|------|------|------|
| The bot: mentions, lock, resolver, public pages on `localhost:3000` | `vaticeno` | always, restarts itself |
| The owner's status page, `localhost:3001` | `vaticeno-status` | always |
| Testnet settlement worker | `vaticeno-settle` | always, if `/etc/vaticeno-settle/env` exists |
| One settlement worker per market (`8453`, `42161`, `42161-usdt`) | `vaticeno-settle@<market>` | always, if `/etc/vaticeno-settle/<market>/env` exists |
| The feed: reposts, queued post, digest, record, event, race and verdict posts | `vaticeno-content-<job>.timer` → `vaticeno-content@<job>` | see the table below |
| HTTPS in front: `vaticeno.n30sk.cc`, `/status` | `caddy`, `deploy/Caddyfile` | always |

## Every scheduled job

All times UTC. The bot's jobs run inside `vaticeno` (node-cron); the feed jobs run from systemd timers, so a stopped
bot never stops the feed. Times live in `SCHEDULES` (`src/jobs/scheduler.ts`); a timer file must match it (a test checks).

| Job | When | What it does | Code |
|-----|------|--------------|------|
| `mentions` | every minute | reads new mentions, one reply each | `src/bot/mentions.ts` |
| `lock` | every minute | locks drafts past their 15 min, posts the lock replies | `src/lifecycle/lock.ts`, `src/bot/verdicts.ts` |
| `expire` | every 10 min | expires needs-info with no fix in 24 h, and withheld drafts | `src/lifecycle/expire.ts` |
| `resolve` | hourly, :00 | judges claims past their deadline | `src/resolve/resolver.ts` |
| `verdicts` | every 5 min | posts each verdict once in its thread, then corrections | `src/bot/verdicts.ts` |
| `reconcile` | every 2 h, :17 | names work owed and never done | `src/lifecycle/reconcile.ts` |
| `recheck` | Mon 04:31 | re-judges last week's verdicts from stored evidence | `src/resolve/recheck.ts` |
| `pool` (timer) | daily 09:23 | reposts the most-liked upcoming-event post | `src/content/pool-run.ts` |
| `original` (timer) | daily 13:41 | the owner's queued post for today, if any | `src/content/original-run.ts` |
| `event` (timer) | daily 15:11 | an event post with a poster, if today's own-post slot is free | `src/content/event-run.ts` |
| `verdict` (timer) | daily 16:29 | reposts one fresh verdict reply of a listed author | `src/content/verdict-run.ts` |
| `digest` (timer) | Mon 08:17 | listed authors' predictions coming due this week | `src/content/record-run.ts` |
| `record` (timer) | Fri 09:47 | the week's record in counts | `src/content/record-run.ts` |
| `race` (timer) | Fri–Sat 14:13 | the weekend's biggest Hong Kong race, with odds | `src/content/race-run.ts` |
| backup (timer) | daily 03:30 | database backup | `deploy/backup.sh` |

`deploy/setup.sh` installs Node 22, Python's venv, Caddy, swap, the log cap and both users. `deploy/deploy.sh`
syncs the code and installs and starts every unit above. Neither touches a secret.

Not on the server: the database (Supabase), the verifier (Cloud Run, `verifier/serve/deploy.sh`), the analytics
(Cloudflare).

## The secrets: the only things not in git

| File | What |
|------|------|
| `/opt/vaticeno/.env` | the bot's keys: X, models, database, Sentry, wager networks |
| `/opt/vaticeno/.env.status` | the status page's read-only database login (`deploy/status-role.md`) |
| `/opt/vaticeno/.state/` | the X login, rotated on every refresh; the verifier's account key; the mention cursor |
| `/etc/vaticeno-settle/` | each settlement worker's env file and oracle key |

`deploy/move.sh` copies all four from the old server to the new one.

## Moving to a new server

```bash
ssh root@NEW 'bash -s' < deploy/setup.sh    # the machine: Ubuntu 24.04
deploy/move.sh root@OLD root@NEW            # stops everything on OLD, copies the secrets
deploy/deploy.sh root@NEW                   # code, units, timers, Caddy
```

Then point the DNS record of `vaticeno.n30sk.cc` at NEW; Caddy gets the certificate once it resolves. Check:
`systemctl list-timers 'vaticeno*'` lists five timers, and `systemctl is-active vaticeno vaticeno-status caddy`
says active three times.

OLD stays stopped and disabled. Never start it again while NEW runs: two bots reply twice and fight over the X
login. The bot is down from `move.sh` to the end of `deploy.sh`, a few minutes; a missed feed run catches up.

## Not installed

The nightly database dump (`deploy/backup.sh`, `vaticeno-backup.timer`) needs `pg_dump` and an `rclone` remote;
it is not on the current server.
