# 005 — The verifier runs on our own Cloud Run service, not on the droplet

**Date**: 2026-10-25 · **Decided by**: the owner · **Status**: accepted ·
**Changes**: 003 FR-012a (was "one call on localhost"); 001-second-runtime's verifier row ·
**Relates to**: 004-practice-model, constitution V

## Why

The published model (`Leminds/deberta-v3-xsmall-nli-oanc`, decision 004) needs about 320 MiB to run. The
droplet has 458 MiB in all and about 128 MiB free when the bot and the status page peak (003 capacity.md).
Resizing the droplet costs money every month for an experiment that decides nothing.

The first choice was a private Hugging Face Space, as another project of the owner's runs. Creating it was
refused the same day: new Docker and Gradio Spaces on free hardware now need a PRO subscription ($9/month).
Cloud Run's free tier (2M requests, 180k vCPU-seconds, 360k GiB-seconds a month) runs the same image for
nothing at our volume.

## Chosen

| Item | Choice |
|---|---|
| Where | a **private** Cloud Run service, `vaticeno-verifier`, us-central1, in the project that already holds the Gemini key; 1 vCPU, 1 GiB, scales to zero, one instance, one request at a time |
| The model | the published int8 ONNX file and tokenizer, fetched at build time by commit and sha256 |
| Who may call | Google refuses any call without an identity token for an account with `run.invoker`; the service then checks our own key (`X-Verifier-Key`, in Secret Manager) |
| The call | one HTTPS POST per passed page from Node, one page after another, 30 s timeout, and no calls for 10 minutes after a timeout or a dropped connection; any failure, refusal, malformed answer or a slow cold start means **no opinion** and today's paid path, unchanged |
| What it holds | no database connection, no stored request, no log line with request text; it answers and forgets |
| What it decides | nothing: shadow rows only (FR-016); going live is parked, it would avoid no paid call (spec SC-006) |
| Cost guard | a $1 budget alert on Cloud Run in that project |

## Constitution V

V forbids **storing** content. The page text a verifier call carries is in memory on our droplet already;
the call sends it, for the length of one request, to a process we own on a host we chose, which keeps
nothing. That is a new boundary — the text leaves the droplet — and it is accepted on these terms: our own
private service, credentials only Node holds, no logging of bodies, nothing written to disk. Cloud Run's
request log records the path, status and latency, never a body. A third-party inference API that may retain
inputs would not meet them.

## Accepted costs

- Scaling to zero means a cold start: the first call after an idle spell waits for the container and the
  model to load. A call that misses the timeout is recorded as an error, never as an answer. Shadow mode can
  afford that; a live fast path would count it in its availability.
- Measured 2026-10-25/26 from the owner's machine: a short pair answers in about 0.35 s warm (45 ms of it
  inference), a full 40,000-character page (16 windows) in about 12 s, a cold start adds 7.6 s. Four full pages at
  once on one CPU failed three of them, hence one request at a time.
- A billing account is attached. The free tier covers our volume; the budget alert says when it would not.
- Google can change free-tier terms. The service is a container: it moves to any host with the same image.
