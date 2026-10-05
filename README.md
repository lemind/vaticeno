# Vaticeno

An X bot that puts predictions **on the record** and checks them automatically on the deadline.

```
@vaticeno BTC above $150,000 by 2026-12-31
  → RECORDED · #slug + the exact statement it will judge (fix it within 15 min by replying)
  → after the deadline: HIT / MISS / VOID as a reply in the same thread
```

## Status

**Live on X (testing):** tag the bot under your prediction (or put it in the mention): it records it and
answers once in the thread; reply under its answer to fix it within 15 min. After the deadline the verdict
(HIT / MISS / VOID) is posted as a reply in the same thread. Spec and tasks: [spec](specs/001-stage0-contract-core/spec.md),
[tasks](specs/001-stage0-contract-core/tasks.md). How it runs: one service with five timed jobs
(mentions and lock every minute, expire every 10 min, resolve hourly, verdicts every 5 min).

**Next (spec 002, own feed):** [spec](specs/002-content-feed/spec.md), [tasks](specs/002-content-feed/tasks.md).
Twice a day the bot picks one account from a fixed pool by weight and reposts its latest post, or quotes it
with a line of its own; plus one owner-written post a day and verdict receipts. Off by default
(`ENABLE_FEED=false`), and dry-run first.

| Done | Next |
|---|---|
| X: mentions → one reply each; fixes by replying under the bot's answer; STOP; help; verdict replies | Per-claim AI budget in the live resolver |
| Predictions → contracts by AI, checked in code; price + date = daily close; unclear ones get a checked example | |
| Sports: the match must exist (web search), competition filled in, recordable until kickoff | Public pages on a domain (HTTPS config is ready in `deploy/`) |
| Database: lock and verdict rules enforced by Postgres, locally and on Supabase | Nightly backups (scripts in `deploy/`, not installed) |
| Verdicts after the deadline: Coinbase daily close, or AI reading web pages behind code gates; human review | |
| Own feed (spec 002), groundwork: rule change, settings, tables, the 15-account pool with weights, the X repost and quote calls, daily caps and "never twice" enforced by Postgres | The twice-a-day job itself, then a week of dry run before anything is posted |
| Claim and author pages (localhost on the server) | |
| Error tracking, logs and alerts (Sentry, production only); tests on every pull request | |

## Commands (on X)

| You post | The bot |
|---|---|
| `@vaticeno <prediction with a date>` | RECORDED · #slug, or NOT RECORDED with what's missing and an example |
| `@vaticeno` as a reply to your own post | records that post |
| a reply under the bot's answer | a fix (within 15 min of RECORDED; anytime within 24 h of NOT RECORDED) |
| `@vaticeno help` (or anything that isn't a prediction) | the list of actions |
| `@vaticeno quote` | a sourced quote from Wikiquote about bets, luck, risk, sport, bitcoin |
| `@vaticeno selfpromo` (or promote, show off, flex, brag, who are you…) | a motto + a joke |
| `@vaticeno STOP` | stops replying to you until you tag it again |
| `@vaticeno ping` | `pong` |

Bare commands and typos (`quote`, `qoute 2`) are matched instantly; anything else unclear ("quote me something
nice", "so?" under a quote, a question) is read by the AI together with the thread above it.

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
