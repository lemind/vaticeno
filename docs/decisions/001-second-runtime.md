# 001 — A second runtime: Python beside Node

**Date**: 2026-10-09 · **Decided by**: the owner · **Status**: accepted ·
**Amends**: constitution VII (2.6.0 → 2.7.0)

## The decision

The operational and advisory services are written in Python 3.12 and run as their own processes. The claim
pipeline — mentions, recording, locking, resolving, posting — stays in the one TypeScript process it is in
today, and so does everything that talks to X.

## Why

Two reasons, and both of them are real.

**The verifier needs Python.** The entailment models planned for Stage 3 and the libraries that run them
exist in Python. Reimplementing inference in TypeScript, or shelling out to a Python child process from
Node, is more moving parts than a second service, not fewer.

**The owner wants Python work that exists.** This is a stated goal of the feature, not a side effect: the
status page is deliberately written in the language the owner is looking for work in. A technical decision
may be made for a career reason as long as it is written down as one, which is what this paragraph is.

## The boundary

This is the part that matters, because "we added Python" without a line is how a codebase ends up with two
of everything.

**Python may hold** read-only operational surfaces (the status page), load-testing harnesses, and advisory
components the pipeline runs fine without (the local verifier). The settlement worker is Python too, and is
the one exception to "read-only or advisory": it holds a signing key and does nothing else, precisely so
that the process parsing posts from strangers never holds one.

That separation is about responsibility. The key also needs isolating, which is three further rules, all of
them because the two runtimes share a database and a row in a table is not an instruction:

- The key is readable by the worker's own operating-system user and by nobody else. It is not in the
  repository, not in the database and not in the environment of any other unit.
- The worker **builds the transaction itself** from the claim and the verdict it reads. It never signs a
  payload handed to it. There is no code path from a database column to bytes that get signed.
- Before signing, it checks the whole shape of what it is about to do against the chain and the record:
  the stake's on-chain state, the destination, the amount, the chain id, the contract address, and that
  this stake has not been settled already. Any mismatch stops and reports instead of signing.

Database access is not signing authority. An attacker who can write an outbox row must still be unable to
make the worker sign anything the contract and the verdict do not already imply.

**Python may not hold** the claim pipeline, the X client, the resolver's decision rules, or anything that
posts. A verdict is decided and published by the TypeScript service, as it is today.

**How they talk to each other**, service by service — there is no single answer, and saying "they share a
database" would be wrong about the verifier:

| Service | Interface | Direction |
|---|---|---|
| Status page | the database, through a read-only role | reads only; never contacts Node |
| Settlement worker | the outbox table | reads rows, writes results; never contacts Node |
| Load harness | the public HTTP surface of a local copy | never touches production |
| Local verifier | one HTTP call on localhost, from Node | holds no database connection at all |

The verifier is the only synchronous dependency, and it is deliberately the weakest one. Node calls it
with a hard timeout, in front of the paid model; a timeout, a refusal, a malformed answer or a closed port
all mean the same thing — **no opinion** — and the resolution continues down the paid path it would have
taken anyway. The call is an optimisation that can be removed at any moment by switching it off, not a
step the pipeline depends on. It never decides alone (FR-013) and it is never consulted at all for anything
carrying money (FR-031).

**What is forbidden in every direction**: shared files, shared memory, importing one side's code from the
other, and any call from Python into the claim pipeline. Python is never upstream of a verdict.

**Failure is one-directional.** If the Python side is missing, slow or broken, the Node side behaves exactly
as if it had never been deployed: the verifier call fails and the paid model answers (constitution III), the
status page is simply down, the settlement outbox fills up until the worker returns — and if it never does,
the contract's timeout refund makes everyone whole without us. Nothing in the claim pipeline waits on a
Python process, ever.

## What it costs

A second set of dependencies to keep current, a second deploy path, a second language for anyone reading
the repo, and **three more systemd units** — the status page, the verifier and the settlement worker are
separate long-lived processes, each supervised and restarted on its own, not one unit running several
things. Each stage brings its unit with it: the status page in Stage 1, the settlement worker in Stage 2,
the verifier in Stage 3, so the cost arrives in three instalments rather than at once. Three more things
that can be down at three in the morning. Principle VII exists to stop exactly this, and the cost is
accepted knowingly rather than argued away.

Every new Python dependency still needs explicit approval and a stated reason, the same as a Node one.

## What would reverse it

If the local verifier is measured and saves too little to be worth keeping — the outcome Stage 3 is
explicitly allowed to reach — then the only remaining Python is the status page, which is a few hundred
lines. At that point moving it back into the Node service and deleting the runtime is the smaller system,
and this decision should be revisited rather than defended.

## The amendment

Principle VII gains:

> A second runtime is allowed for read-only operational services, for advisory components the pipeline can
> run without, and for a settlement worker that holds a signing key and does nothing else; the claim
> pipeline, the X client and anything that posts stay in one TypeScript process. The runtimes integrate
> only through a database table or one bounded call the caller treats as optional — never shared files,
> shared memory or imported code — and a failure on the second side never changes what the first one does.

See [specs/003-python-platform/plan.md](../../specs/003-python-platform/plan.md) → Complexity Tracking for
the alternatives that were rejected.
