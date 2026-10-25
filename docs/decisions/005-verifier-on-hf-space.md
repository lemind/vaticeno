# 005 — The verifier runs on our own Hugging Face Space, not on the droplet

**Date**: 2026-10-25 · **Decided by**: the owner · **Status**: accepted ·
**Changes**: 003 FR-012a (was "one call on localhost"); 001-second-runtime's verifier row ·
**Relates to**: 004-practice-model, constitution V

## Why

The published model (`Leminds/deberta-v3-xsmall-nli-oanc`, decision 004) needs about 320 MiB to run. The
droplet has 458 MiB in all and about 128 MiB free when the bot and the status page peak (003 capacity.md).
Resizing the droplet costs money every month for an experiment that decides nothing. The owner already runs
a model this way for another project: a Docker FastAPI app on a free Hugging Face Space, called over HTTPS
with a bearer token.

## Chosen

| Item | Choice |
|---|---|
| Where | a **private** Space, `Leminds/vaticeno-verifier`, Docker SDK, free cpu-basic (2 vCPU, 16 GB) |
| The model | the published int8 ONNX file and tokenizer, fetched at build time by commit and sha256 |
| The call | one HTTPS POST per evidence page from Node, bearer token, hard timeout; any failure, refusal, malformed answer or a sleeping Space means **no opinion** and today's paid path, unchanged |
| What it holds | no database connection, no stored request, no log line with request text; it answers and forgets |
| What it decides | nothing until SC-005's count is met: shadow rows only (FR-016) |

## Constitution V

V forbids **storing** content. The page text a verifier call carries is in memory on our droplet already;
the call sends it, for the length of one request, to a process we own on a host we chose, which keeps
nothing. That is a new boundary — the text leaves the droplet — and it is accepted on these terms: our own
private Space, a token only Node holds, no logging of bodies, nothing written to disk. A third-party
inference API that may retain inputs would not meet them.

## Accepted costs

- The free Space sleeps when idle; the first call after a sleep times out and is recorded as an error, never as
  an answer. Shadow mode can afford that; a live fast path would count it in its availability.
- Latency is a network round trip plus CPU inference on shared vCPUs (another project measured about 2 s a
  pair for a model of this size). Nothing waits on it in shadow mode.
- Hugging Face can change free-tier terms. The service is a container: it moves to any host with the same
  image and the same token.
