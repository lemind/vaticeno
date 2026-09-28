# Vaticeno

An X bot that puts predictions **on the record** and checks them automatically on the deadline.

```
@vaticeno record BTC daily close above $150,000 by 2026-12-31
  → RECORDED · the exact statement it will judge
  → (deadline) HIT / MISS / VOID, posted in the same thread
```

## Status

**Proof of concept.** What works today:

| Works | Not yet |
|---|---|
| Reads mentions of `@vaticeno` every 60 s | Turning predictions into contracts |
| Parses `record`, `amend`, `STOP` (log only) | Resolving on the deadline |
| Replies `pong` to `@vaticeno ping` | Database, public claim pages |

## Commands (on X)

| Post | Bot does |
|---|---|
| `@vaticeno ping` (the word *ping* anywhere) | replies `pong · HH:MM:SS UTC` |
| `@vaticeno record <prediction>` | logs it (recording not live yet) |
| `@vaticeno amend <corrected text>` | logs it |
| `@vaticeno STOP` | logs an opt-out |

## Run locally

Requires Node 22 and an X developer app (setup: [docs/poc-x-setup.md](docs/poc-x-setup.md)).

```bash
npm install
cp .env.example .env      # fill in X tokens
npm run poc:whoami        # prints the bot's user ID for .env
npm run poc:poll          # start the bot
```

Only one copy may run at a time — two would double-reply and break each other's login token.

Reply caps (`.env`): 3 per author per hour, 300 per day. Logs never contain post text.

## Scripts

| Script | Purpose |
|---|---|
| `npm run poc:poll` | the bot: poll mentions, reply to `ping` |
| `npm run poc:parse -- "<text>"` | see how a mention is parsed, offline |
| `npm run poc:whoami` | look up the bot's user ID |
| `npm run poc:auth` | one-time browser login so the bot can post |
| `npm test` / `npm run typecheck` | tests / type check |

## Deploy (VPS)

```bash
ssh root@HOST 'bash -s' < deploy/setup.sh     # once: Node 22, swap, service user
scp .env root@HOST:/opt/vaticeno/             # once: secrets, never in git
scp .state/* root@HOST:/opt/vaticeno/.state/  # once: cursor + OAuth token (stop local bot first)
deploy/deploy.sh root@HOST                    # every update: sync, install, restart
```

Runs as systemd service `vaticeno` · logs: `journalctl -u vaticeno -f`

## Layout

```
src/
  commands/   command parser (record, amend, STOP, ping)
  ingest/     mention decisions + since_id cursor
  x/          X API client + OAuth 2.0
  poc/        runnable entry points
deploy/       systemd unit + VPS scripts
docs/         setup guides
```

## Stack

Node 22 · TypeScript (strict) · Zod · X API v2. Planned: Fastify, PostgreSQL + Drizzle, node-cron.
