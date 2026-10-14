# 003 — Redis and RabbitMQ: where, and when

**Date**: 2026-10-14 · **Decided by**: the owner · **Status**: planned, not triggered ·
**Relates to**: constitution VII ("absent until justified by measurement")

## The decision

Four conditional upgrades, each with a named job and a measured trigger. Today none is worth it: nine
scheduled jobs on one box, one instance, polling X. No dependency, switch or shared abstraction is added
ahead of a trigger. The status page and capacity measurements already planned come first; they decide
which, if any, of these is built.

## Triggers

Each is a quantity measured with its date and hardware. The threshold is set by the owner once the
number exists; until then it is **UNRECONCILED**.

| Upgrade | Measure | Plus |
|---|---|---|
| **Redis: cache of fetched evidence pages** | on a deadline day: the share of fetches repeating a URL within the TTL, and the p95 time they add to a resolve run | an owner decision allowing page text in memory (004 stores none) |
| **Redis: shared X API budget** | with two instances: p95 added to each X call by a Postgres counter, at the measured call rate | a second instance runs |
| **RabbitMQ: buffer at ingest** | p95 backlog age of an inbox table during the largest measured burst, against the reply window | mentions arrive by webhook or stream |
| **RabbitMQ: fan-out to other platforms** | p95 delivery lag per platform from a Postgres outbox with one worker each | a second platform exists |

## Switch off, and dependency down

Two different states. Off is today's behaviour; down happens after activation, and may need a safer path.

| Upgrade | Switch off | Dependency down |
|---|---|---|
| Evidence cache | fetch the page | fetch the page |
| Shared X budget | one instance, its own counter | **fail closed**: calls wait. Never independent per-process counts, which overshoot the shared budget |
| Ingest buffer | the one-minute poll | the poll, which reads from its own cursor and so replays whatever a webhook missed |
| Fan-out | the outbox | the outbox |

## Rules for every one

- **Correctness stays in Postgres**: one reply per mention, lock and verdict rules, caps, leases. Neither
  service is ever the only authority for a hard limit.
- **The cache is memory only**: persistence off, a TTL on every key. It saves a fetch, not the judge
  call, and a cached page decides nothing a fresh fetch would not: a stale hit is a miss.
- **The poll stays on behind any webhook.** The webhook makes a reply faster; the cursor makes it certain,
  so the fallback cannot silently lose a mention.
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
