# Vaticeno

An X bot that puts predictions **on the record** and checks them automatically on the deadline.

```
@vaticeno record BTC daily close above $150,000 by 2026-12-31
  → RECORDED · the exact statement it will judge
  → (deadline) HIT / MISS / VOID, posted in the same thread
```

## Status

**Live on X:** tag the bot under your prediction (or put it in the mention): it records it and answers once in the thread; reply under its answer to fix it within 15 min.
**In progress:** Stage 0, the offline core ([spec](specs/001-stage0-contract-core/spec.md),
[tasks](specs/001-stage0-contract-core/tasks.md)).

| Done | Next |
|---|---|
| Mention polling, `ping` → `pong` on X | Replies on X (Stage 1, after X approval) |
| Database: tables, lock and verdict rules enforced by Postgres, locally and on Supabase | |
| Predictions → contracts, unclear ones get a checked example, fixes before lock | |
| Resolving claims after the deadline (price feed, AI reading web sources), human review | |
| Public claim and author pages (`npm run dev`) | |
| Error tracking, logs and alerts (Sentry); tests on every pull request | |
| Jobs inside the server (`ENABLE_JOBS=true`), nightly backups, HTTPS config (`deploy/`) | |

## Commands (on X)

`@vaticeno help` lists what the bot does (not live on X yet). Live today: `@vaticeno ping` → `pong`.

## Run locally

Requires Node 22.9+, Docker, and an X developer app for the bot ([docs/poc-x-setup.md](docs/poc-x-setup.md)).

```bash
npm install
cp .env.example .env      # fill in X tokens; DATABASE_URL already points at local Docker
docker compose up -d      # local Postgres on port 5433
npm run db:migrate
npm test && npm run test:integration
```

The bot itself: `npm run poc:whoami` (prints the bot's user ID for `.env`), then run the server with `ENABLE_JOBS=true ENABLE_X=true`.
Only one copy may run at a time — two would double-reply and break each other's login token.
Reply caps (`.env`): 3 per author per hour, 300 per day. Logs never contain post text.

## Scripts

| Script | Purpose |
|---|---|
| `npm run poc:poll` | old proof-of-concept poller (ping only); do not run next to the service |
| `npm run poc:parse -- "<text>"` | see how a mention is parsed, offline |
| `npm run poc:whoami` / `poc:auth` | bot user ID / one-time browser login for posting |
| `npm run dev` | public pages on `PORT` (default 3000): `/c/<slug>`, `/u/<x_user_id>`, `/healthz` |
| `npm run db:migrate` | apply database migrations (uses `DATABASE_URL`) |
| `npm run db:generate` / `db:studio` | new migration from schema changes / browse tables |
| `npm test` / `test:integration` | unit tests / database tests (needs Docker Postgres) |
| `npm run test:coverage` / `typecheck` | coverage report (~55% is a cap, not a goal) / type check |

Stage 0 commands (`corpus`, `seeds:*`, `claim:*`, `jobs:tick`, `review:list`, `resolve:manual`) are
listed in [contracts/cli.md](specs/001-stage0-contract-core/contracts/cli.md).

## Deploy (VPS)

```bash
ssh root@HOST 'bash -s' < deploy/setup.sh     # once: Node 22, swap, service user
scp .env root@HOST:/opt/vaticeno/             # once: secrets, never in git
scp .state/* root@HOST:/opt/vaticeno/.state/  # once: cursor + OAuth token (stop local bot first)
deploy/deploy.sh root@HOST                    # every update: sync, install, restart
```

Runs as systemd service `vaticeno`. Logs: `journalctl -u vaticeno -f` on the server, and Sentry
(errors, logs, alerts) when `SENTRY_DSN` is set. Production database: Supabase (Frankfurt), connection
string in the gitignored `.env.production`.

## Layout

```
src/
  contract/   contract schema, statement template, slugs        (pure)
  lifecycle/  claim states                                      (pure now; services next)
  db/         tables, connection, migrations, cost records
  llm/        AI model client, offline replay store, prices
  jobs/       job lock (one run at a time)
  cli/        command-line entry points
  commands/ ingest/ x/ poc/   the live proof-of-concept bot
drizzle/      SQL migrations (tables, triggers, row-level security)
tests/        database tests against real Postgres
deploy/       systemd unit + VPS scripts
specs/        what we build and why (spec, plan, tasks)
```

Code follows a light "pure core, I/O at the edges" structure — see
[plan.md → Architecture](specs/001-stage0-contract-core/plan.md#architecture).

## Stack

Node 22 · TypeScript (strict) · Zod · PostgreSQL (Supabase) + Drizzle · Gemini · Sentry · X API v2.
Fastify (server-rendered pages, no client JS) · node-cron (jobs in the same process).
