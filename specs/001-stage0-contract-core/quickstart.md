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

## Prove the core (all offline, replay mode, zero cost)

```bash
npm run corpus            # proposal + checks over 100 fixtures → pass rate (≥ 90%)
npm run seeds:crypto      # 60 frozen crypto claims → must be 100%
npm run seeds:open        # seeded open-topic claims (SC-003 mix) → agreement ≥ 95%, wrong HIT/MISS < 5%
npm test                  # unit tests
npm run test:integration  # DB integration tests (needs `docker compose up -d`; each run creates its own scratch database)
docker compose down -v    # reset the local database completely
```

## Walk one claim through its life (simulated time)

```bash
npm run claim:submit -- --text "BTC daily close above \$150,000 by 2026-12-31" --author 200 --post 9001
npm run jobs:tick -- --now 2026-09-28T12:20:00Z        # lock time reached → locked
npm run jobs:tick -- --now 2027-01-01T01:00:00Z        # deadline passed → resolved
npm run dev                                            # open http://localhost:3000/c/<slug>
```

## Choosing model tiers (live, costs a few cents)

```bash
LLM_MODE=record npm run corpus -- --model <cheapest-flash-tier>
LLM_MODE=record npm run seeds:open     # uses JUDGE_MODEL_A/B and ARBITER_MODEL from .env
```
Pick the cheapest tier that meets SC-001 / SC-003; set it in `.env`; recordings become the new replay set.

## Production (droplet)

- Supabase project `vaticeno` (Frankfurt). `DATABASE_URL` = session pooler string
  (`aws-1-eu-central-1.pooler.supabase.com:5432`, user `postgres.<project-ref>`), kept in the
  gitignored `.env.production`. Migrate: `node --env-file=.env.production --import tsx src/cli/db-migrate.ts`.
- Droplet resized to 1 GB; `deploy/deploy.sh` as today; Caddy in front for `vaticeno.app`.
- Nightly `pg_dump` cron on the droplet to off-box storage; test one restore before launch.
