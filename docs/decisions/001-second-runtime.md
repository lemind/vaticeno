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

**Python may not hold** the claim pipeline, the X client, the resolver's decision rules, or anything that
posts. A verdict is decided and published by the TypeScript service, as it is today.

**They share a database and nothing else.** No shared files, no shared memory, no calls between the
processes, no importing one from the other. If the two sides need to agree on something, it is a table.

**Failure is one-directional.** If the Python side is missing, slow or broken, the Node side behaves exactly
as if it had never been deployed: the verifier falls through to the paid model (constitution III), the
status page is simply down, the load harness is not running anyway. Nothing in the claim pipeline waits on
a Python process, ever.

## What it costs

A second set of dependencies to keep current, a second deploy path, a second systemd unit, a second thing
that can be down at three in the morning, and a second language for anyone reading the repo. Principle VII
exists to stop exactly this, and the cost is accepted knowingly rather than argued away.

Every new Python dependency still needs explicit approval and a stated reason, the same as a Node one.

## What would reverse it

If the local verifier is measured and saves too little to be worth keeping — the outcome Stage 3 is
explicitly allowed to reach — then the only remaining Python is the status page, which is a few hundred
lines. At that point moving it back into the Node service and deleting the runtime is the smaller system,
and this decision should be revisited rather than defended.

## The amendment

Principle VII gains:

> A second runtime is allowed for read-only operational services and for advisory components the pipeline
> can run without, and for a settlement worker that holds a signing key and does nothing else; the claim
> pipeline, the X client and anything that posts stay in one TypeScript process. The runtimes share a
> database and nothing else, and a failure on the second side never changes what the first one does.

See [specs/003-python-platform/plan.md](../../specs/003-python-platform/plan.md) → Complexity Tracking for
the alternatives that were rejected.
