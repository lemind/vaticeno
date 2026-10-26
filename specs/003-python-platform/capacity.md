# Capacity

Measured numbers only, each with its date and the machine (003 SC-003, FR-009). Nothing is estimated: a
number nobody measured is absent rather than guessed.

## How these were produced

```bash
# Public pages. Local targets only — load/guard.py refuses anything else (FR-008).
LOAD_SLUG=<slug> LOAD_AUTHOR=<x_user_id> .venv/bin/locust -f load/locustfile.py \
  --headless -H http://localhost:3000 -u 100 -r 50 -t 30s --only-summary

# The mention path, with a stubbed X and a stub model.
npm run load:burst
```

The page run needs a claim with a position row, or a quarter of the requests are 404s and the latency
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

**The ceiling is the pool**, not the CPU or the database, so raising `max` is the first lever if page
traffic ever matters. It is 5 because the Supabase pooler is the real constraint (001 research R1).

**The mention path has about sixty times the headroom it needs** at today's volume: ten times the live
rate drains in a second, inside the one-minute poll window. Caps shape a flood, not throughput.

## Droplet — memory measured, throughput not

458 MB RAM total, 212 MB available, plus a 1 GB swapfile · the bot's own peak is **149 MB** (systemd
`MemoryPeak`, read 2026-10-13, not under load).

| What | Status |
|---|---|
| Request rate and p95 on the droplet | **not measured** — needs a load run against the server |
| Peak RSS under synthetic load on the droplet | **not measured, on purpose**: no load run against production (FR-008) |
| Bot (`vaticeno`), systemd `MemoryPeak` | **148 MiB**, 126 MiB at the read (2026-10-25, minutes after a deploy restart, so the peak is its start-up; 147 MiB over two days of traffic on 2026-10-20) |
| Status service (`vaticeno-status`), systemd `MemoryPeak` | **56 MiB**, 53 at the read (also just restarted; 60 MiB peak on 2026-10-20) |
| Settlement worker (`vaticeno-settle`), systemd `MemoryPeak` | **72 MiB** over two days running (since 2026-10-23), 8 MiB at the read: it wakes, works and sleeps |
| Local verifier | **0 on the droplet**: it runs on Cloud Run (decision 005); the bot's client adds no measurable memory |
| Headroom with all three running (SC-008) | **196 MiB available** of 458; **about 108 MiB** if all three hit their peaks together (148 + 56 + 72 = 276 MiB, beside about 74 MiB the system holds), before the 1 GB swap, of which 124 MiB was in use |

Read 2026-10-25 from systemd on the droplet, one CPU. A load run there drives the live service, which posts
to X and spends money, so peaks come from real traffic rather than a burst (FR-008). The peaks are each
process's own and need not coincide; the sum is the worst case. Previous read: 2026-10-20, two processes,
about 128 MiB of worst-case headroom.

## Still UNRECONCILED, and not by omission

Load runs stub X, the paid model and the price feed — that is what makes them safe to run (FR-008). So no
load run can answer a price or a billing category. These stay labelled until a billing experiment answers
them (INIT_SPEC §9):

- X read, post and repost prices, and which category a summoned reply bills under
- Model and search prices in `src/llm/prices.ts`
- ~~The share of resolutions that avoid a paid call (SC-006)~~: zero by design, the fast path is parked (spec SC-006)
