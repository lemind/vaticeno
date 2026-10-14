# 002 — Redis and RabbitMQ: where, and when

**Date**: 2026-10-14 · **Decided by**: the owner · **Status**: planned, not triggered ·
**Relates to**: constitution VII ("absent until justified by measurement")

## The decision

Four conditional upgrades, each with a named job and a measured trigger. Today none is worth it: nine
scheduled jobs on one box, one instance, polling X. No dependency, switch or shared abstraction is added
ahead of a trigger. The status page and capacity measurements already planned come first; they decide
which, if any, of these is built.

## The four

| Upgrade | Trigger: measured, with date and hardware | Off, or dependency down |
|---|---|---|
| **Redis: cache of fetched evidence pages** | repeat fetches on a deadline day cost more than the cache. **Blocked first** on an owner decision: 004 stores no page text, so a body may be cached only with a written retention limit (TTL, memory only, never persisted) | fetch the page, as today |
| **Redis: shared X API budget** | a second instance runs **and** a Postgres counter is measured too slow for it | fail closed: the affected calls wait. Never per-process counts, which overshoot the shared budget |
| **RabbitMQ: buffer at ingest** | mentions arrive by webhook or stream **and** measured bursts outrun an inbox table | the one-minute poll |
| **RabbitMQ: fan-out to other platforms** | a second platform exists **and** a Postgres outbox with one worker per platform is measured short on delivery or backpressure | the outbox |

## Rules for every one

- **Correctness stays in Postgres**: one reply per mention, lock and verdict rules, caps, leases. Neither
  service is ever the only authority for a hard limit.
- **A broker delivers at least once.** A consumer posts only through the existing reservation, checks
  existence when delivery was ambiguous, and leaves the rest to reconcile (INIT_SPEC §6.7). Nothing here
  promises an exactly-once post.
- The settlement outbox stays a table: on-chain sends need per-account nonce order, and competing
  consumers reorder (001-second-runtime).
- When one is built: its own spec, dependency approval with the measured reason (VII), a switch off by
  default, and a row on the status page.

## Not on this list

A leaderboard: author pages show raw counts only, no ranking (INIT_SPEC §10). That is a product decision
before it is a storage one. The status page login throttle: Caddy first.

## What would cancel it

A trigger that never comes. One instance on a poll means this stays a plan, and that is the right outcome.
