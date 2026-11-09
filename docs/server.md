# The server

Everything the server runs is in this repo, except the secrets. Moving to a new server is three commands and a DNS change.

## What runs

| What | Unit | When |
|------|------|------|
| The bot: mentions, lock, resolver, public pages on `localhost:3000` | `vaticeno` | always, restarts itself |
| The owner's status page, `localhost:3001` | `vaticeno-status` | always |
| Testnet settlement worker | `vaticeno-settle` | always, if `/etc/vaticeno-settle/env` exists |
| One settlement worker per market (`8453`, `42161`, `42161-usdt`) | `vaticeno-settle@<market>` | always, if `/etc/vaticeno-settle/<market>/env` exists |
| The feed: reposts, the owner's queued post, digest, record, event post | `vaticeno-content-<job>.timer` → `vaticeno-content@<job>` | the times in `SCHEDULES` (`src/jobs/scheduler.ts`) |
| HTTPS in front: `vaticeno.n30sk.cc`, `/status` | `caddy`, `deploy/Caddyfile` | always |

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
