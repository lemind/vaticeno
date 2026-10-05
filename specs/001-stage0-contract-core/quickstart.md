# Quickstart: Stage 0

## Local setup

```bash
npm install
docker compose up -d          # local Postgres 16 (compose.yaml), db "vaticeno", password "dev"
cp .env.example .env
#   DATABASE_URL=postgres://postgres:dev@localhost:5433/vaticeno
#   GEMINI_API_KEY=...          (only for LLM_MODE=live|record)
#   NORMALIZER_MODEL=... JUDGE_MODEL_A=... JUDGE_MODEL_B=... ARBITER_MODEL=...   LLM_MODE=replay
npm run db:migrate
```

## Prove the core (free, no AI key)

```bash
npm test                  # unit tests
npm run test:integration  # DB integration tests (needs `docker compose up -d`; each run creates its own scratch database)
npm run seeds:crypto      # 60 frozen crypto claims → must be 100% (no AI, no network)
docker compose down -v    # reset the local database completely
```

`corpus` and `seeds:open` need the real AI (live, or answers recorded earlier on this machine in the
gitignored `fixtures/replay/`). Paid runs are not part of the routine: accuracy is checked by hand on a few
real claims at release (spec Assumptions).

## Walk one claim through its life (simulated time)

`claim:submit` and `claim:reply` call the AI once each (`LLM_MODE=live` with `GEMINI_API_KEY`, well under a
cent). `--now` moves the clock; use times after the submit.

```bash
npm run claim:submit -- --text "BTC to 150k" --author 200 --post 9001          # NOT RECORDED: no date
npm run claim:reply -- --slug <slug> --text "BTC daily close above \$150,000 by 2027-12-31"   # RECORDED
npm run claim:edit -- --slug <slug> --text "BTC daily close above \$160,000 by 2027-12-31"    # optional: edit the post
npm run jobs:tick -- --now <submit + 16 min>          # lock time: locked (or [AMENDED] / [EXPIRED] after an edit)
npm run jobs:tick -- --now 2028-01-01T01:00:00Z       # deadline passed → resolved from Coinbase candles
npm run review:list                                   # anything flagged for a human; decide with resolve:manual
npm run dev                                           # open http://localhost:3000/c/<slug> and /u/200
```

## Choosing model tiers (live, paid: corpus ~$0.06, open seeds ~$5 — only when you decide to)

```bash
LLM_MODE=record npm run corpus -- --model <cheapest-flash-tier>
LLM_MODE=record npm run seeds:open     # uses JUDGE_MODEL_A/B and ARBITER_MODEL from .env
```
Pick the cheapest tier that meets SC-001 / SC-003; set it in `.env`; recordings become your local replay set (not committed).

## Production (droplet)

- Supabase project `vaticeno` (Frankfurt). `DATABASE_URL` = session pooler string
  (`aws-1-eu-central-1.pooler.supabase.com:5432`, user `postgres.<project-ref>`), kept in the
  gitignored `.env.production`. Migrate: `node --env-file=.env.production --import tsx src/cli/db-migrate.ts`.
- Droplet resized to 1 GB; `deploy/deploy.sh` as today; Caddy in front for `vaticeno.app` (see **HTTPS**).
- Nightly dump off the box; test one restore before launch (see **Backups**).

## Where to look when something is wrong

- **Logs on the droplet**: `journalctl -u vaticeno -f` (JSON lines; `| grep '"level":"error"'`). Retention is capped
  at 500 MB by `deploy/journald-vaticeno.conf`.
- **Sentry** (only with `SENTRY_DSN`): *Issues* for errors and alerts (needs human review, over budget, failing
  jobs), *Logs* for the same JSON lines, *Crons* for the every-minute lock job (silence = jobs stopped).
- **Health**: `GET /healthz` → `{ ok, db, claims_due, oldest_due_age_min, needs_human, last_resolver_run_at }`,
  503 when the database is down. Point an external uptime check (Sentry Uptime or UptimeRobot, free) at it.
- **Jobs**: set `ENABLE_JOBS=true` on exactly one server; `npm run jobs:tick` runs one pass by hand.

## Backups

- Nightly at 03:30 UTC: `deploy/backup.sh` (via `deploy/vaticeno-backup.timer`) dumps Supabase to
  `/var/backups/vaticeno` (7 kept) and, with `BACKUP_REMOTE=<rclone remote>` in `.env.production`, off the box.
  Needs `postgresql-client` (same major version as Supabase) and, for off-box copies, `rclone`.
- Restore test, once before launch, into a scratch database (never into production):
  ```bash
  createdb -h localhost -p 5433 -U postgres vaticeno_restore
  pg_restore --no-owner --dbname=postgres://postgres:dev@localhost:5433/vaticeno_restore /var/backups/vaticeno/<file>.dump
  psql postgres://postgres:dev@localhost:5433/vaticeno_restore -c 'select status, count(*) from claims group by 1'
  ```

## HTTPS

`deploy/Caddyfile` → `/etc/caddy/Caddyfile`, then `systemctl reload caddy`. Caddy gets the certificate for
`vaticeno.app` itself; the app listens on `localhost:3000`.
