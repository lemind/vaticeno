# Vaticeno

An X bot that puts predictions **on the record** and checks them automatically on the deadline.

```
@vaticeno BTC above $150,000 by 2026-12-31
  → RECORDED · #slug + the exact statement it will judge (fix it within 15 min by replying)
  → after the deadline: HIT / MISS / VOID on the claim page
```

## Status

**Live on X (testing):** tag the bot under your prediction (or put it in the mention): it records it and
answers once in the thread; reply under its answer to fix it within 15 min. Verdicts are written to the
claim page, not posted on X. Spec and tasks: [spec](specs/001-stage0-contract-core/spec.md),
[tasks](specs/001-stage0-contract-core/tasks.md). How it runs: one service with four timed jobs
(mentions and lock every minute, expire every 10 min, resolve hourly).

| Done | Next |
|---|---|
| X: mentions → one reply each; fixes by replying under the bot's answer; STOP; help | Verdict replies on X |
| Predictions → contracts by AI, checked in code; price + date = daily close; unclear ones get a checked example | Per-claim AI budget in the live resolver |
| Sports: the match must exist (web search), competition filled in, recordable until kickoff | Public pages on a domain (HTTPS config is ready in `deploy/`) |
| Database: lock and verdict rules enforced by Postgres, locally and on Supabase | Nightly backups (scripts in `deploy/`, not installed) |
| Verdicts after the deadline: Coinbase daily close, or AI reading web pages behind code gates; human review | |
| Claim and author pages (localhost on the server) | |
| Error tracking, logs and alerts (Sentry, production only); tests on every pull request | |

## Commands (on X)

| You post | The bot |
|---|---|
| `@vaticeno <prediction with a date>` | RECORDED · #slug, or NOT RECORDED with what's missing and an example |
| `@vaticeno` as a reply to your own post | records that post |
| a reply under the bot's answer | a fix (within 15 min of RECORDED; anytime within 24 h of NOT RECORDED) |
| `@vaticeno help` (or anything that isn't a prediction) | the list of actions |
| `@vaticeno quote` | a real, verified quote about predictions, risk or chance |
| `@vaticeno selfpromo` | a motto + a joke |
| `@vaticeno STOP` | stops replying to you until you tag it again |
| `@vaticeno ping` | `pong` |

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
Reply caps (`.env`): per author per hour (default 3; the live bot runs with 10) and 300 per day. Logs never
contain post text.

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

Runs as systemd service `vaticeno` (`src/web/server.ts` with `ENABLE_JOBS=true ENABLE_X=true`). Logs:
`journalctl -u vaticeno -f` on the server. Sentry (errors, logs, alerts) reports only from production:
`SENTRY_DSN` and `NODE_ENV=production` in the server's `.env`. Production database: Supabase (Frankfurt),
connection string in the gitignored `.env.production`; apply migrations there with
`set -a; . ./.env.production; set +a; npm run db:migrate` before deploying code that needs them.
Claim pages listen on localhost only: `ssh -L 3000:127.0.0.1:3000 root@HOST`, then `http://localhost:3000/c/<slug>`.

## Layout

```
src/
  web/server.ts  the service entry point: pages + scheduler
  jobs/       scheduler (mentions, lock, expire, resolve) and the job lock
  bot/        X intake: mentions → route → one reply; X post reader
  lifecycle/  record, fix, lock, expire a claim
  contract/   contract schema, checks, statement template, slugs (pure)
  resolve/    verdicts: price feed, web evidence, gates, decision rules
  llm/        Gemini client, instructions (llm/instructions/), replay store, prices
  replies/    reply texts
  feeds/      Coinbase
  db/         tables, connection, cost records
  web/        claim and author pages
  x/          X API client and login
  cli/        command-line entry points
  commands/ ingest/ poc/   the first proof-of-concept bot (not run)
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
