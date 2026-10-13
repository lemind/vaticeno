# Capacity

Measured numbers only. Every row carries the date and the machine it was measured on, because a figure
from a 20-thread laptop says nothing about a 458 MB droplet (003 SC-003, FR-009).

Nothing here is estimated. A number that has not been measured is absent rather than guessed, and the
rows that only the droplet can answer say so.

## How these were produced

```bash
# Public pages. Local targets only — load/guard.py refuses anything else (FR-008).
LOAD_SLUG=<slug> LOAD_AUTHOR=<x_user_id> .venv/bin/locust -f load/locustfile.py \
  --headless -H http://localhost:3000 -u 100 -r 50 -t 30s --only-summary

# The mention path, with a stubbed X and a stub model.
npm run load:burst
```

The page run requires a claim with a position row, or a quarter of the requests are 404s and the latency
figures flatter the service. The first run here made that mistake and was discarded.

## Laptop — 2026-10-13

12th Gen Intel i7-12700H, 20 threads, 38 GB RAM · Node v22.22.1 · PostgreSQL 16.15 in Docker on the same
machine · Fastify with `ENABLE_JOBS=false ENABLE_X=false`, database pool `max: 5`, `prepare: false`.

| What | Measured | Behaviour past the limit |
|---|---|---|
| Public pages, 50 concurrent | 164 req/s, p95 **12 ms** | — |
| Public pages, 100 concurrent | 319 req/s, p95 **20 ms** | — |
| Public pages, 200 concurrent | 431 req/s, p95 **290 ms** | throughput flat, latency rising: saturated |
| Public pages, 300 concurrent | 433 req/s, p95 **610 ms** | latency grows linearly with concurrency |
| **Serving ceiling** | **~430 req/s** | no errors at any level; zero failed requests throughout |
| Database connections under 300 concurrent | **5, never 6** | requests queue in the application; the database is never asked for a sixth |
| Recovery after load stops | **first request 4 ms** | no backlog, no restart, no manual step |
| Node RSS under 300 concurrent | **81 MB, flat** | unchanged across a 25-second run |
| Mention burst, 170 in one poll | **167 mentions/s** (1.017 s) | one reply each, none lost, none answered twice |
| Mention burst re-served | **0 extra replies** | a re-served mention is never answered again |
| One author flooding, 20 mentions | **3 replies** | the per-author cap holds; the rest are withheld, not dropped |

**What the pool number means.** The ceiling is the pool, not the database and not the CPU: five
connections saturate at about 430 req/s, and past that the application queues. That is the designed
behaviour — a clean queue rather than a refusal or a wedge — and it is why raising `max` is the first
lever if page traffic ever matters. It is set to 5 because the Supabase pooler is the real constraint
(001 research R1).

**What the burst number means.** Ten times the live rate arrives and drains in about a second, well
inside the one-minute poll window, so the mention path has roughly sixty times the headroom it needs at
today's volume. The caps are what shape a flood, not the throughput.

## Droplet — not measured

458 MB RAM total, 212 MB available, plus a 1 GB swapfile · the bot's own peak is **149 MB** (systemd
`MemoryPeak`, read 2026-10-13, not under load).

| What | Status |
|---|---|
| Request rate and p95 on the droplet | **not measured** — needs a load run against the server |
| Peak RSS under load on the droplet | **not measured** |
| Status service RSS | **not measured** — the run was interrupted |
| Headroom with all processes running (SC-008) | **not stated**: it needs the two rows above |

A load run against the droplet drives the live service, which posts to X and spends money, so it is an
owner decision and not something a harness should be able to start by accident (FR-008).

What can be said from the figures that exist: the bot peaks at 149 MB of 458 MB, leaving about 212 MB
before swap. The status service is a second Python process on the same box, and until its footprint is
measured, SC-008's headroom stays open.

## Still UNRECONCILED, and not by omission

Load runs stub X, the paid model and the price feed — that is what makes them safe to run (FR-008). So no
load run can answer a price or a billing category. These stay labelled until a billing experiment answers
them (INIT_SPEC §9):

- X read, post and repost prices, and which category a summoned reply bills under
- Model and search prices in `src/llm/prices.ts`
- The share of resolutions that avoid a paid call (SC-006), which needs the verifier in Stage 3
