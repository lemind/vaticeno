# 006 — Real money, with no fee at launch

**Date**: 2026-10-27 · **Decided by**: the owner · **Status**: accepted ·
**Changes**: 003 FR-031h and FR-036a (real value is now this feature's goal, Stage 4), new FR-022a and FR-022b ·
**Relates to**: constitution VII, 002-escrow-v1, 003 tasks Phase 8

## The decision

Real money is what the escrow work was for. Spec 003 delivers it as Stage 4: contract v2 on Base and on
Arbitrum One, staked in native USDC, each network live on its own checklist. **The fee is zero at launch.** The
contract keeps a ceiling of 5% as a constant and a fee recipient fixed at deployment, so a fee could be set by a
new deployment later, never by a setting.

## Why no fee

Taking a share of the pot is what a betting operator does, and is the strongest single sign a regulator reads.
With no fee, Vaticeno takes no money from anyone: two people put up equal stakes, a contract holds them, and the
verdict decides who collects both. That does not by itself settle the legal question — running the referee can
count on its own — so the legal opinion (T380) is asked the exact question: is the no-fee version allowed, and
would a flat per-stake fee, charged to both sides whatever the outcome, change the answer. A fee of any kind is
a new owner decision taken with that written answer, never before it.

## Constitution VII

VII lists payments among the things deliberately absent until justified. Read as it was written — a payment
system, money collected from users for a service (the Stripe kind, also listed as absent in AGENTS.md) — the
no-fee escrow is not one: it takes nothing and charges nothing, and every transfer is a user's own, signed in
their own wallet. So VII is not changed by this decision. A non-zero fee would be money collected from users,
and it reopens VII: it needs this file amended and the constitution's own amendment process.

## What gates it

Nothing is deployed to a mainnet before three things are on file, each dated (003 SC-024): a legal opinion that
says go, an independent review of the release commit with every critical and high finding closed, and the
written incident policy. The order and the work are in 003 tasks Phase 8.

## Accepted costs

- No revenue from wagers. The account's other ways to earn (none built yet) carry it, or nothing does.
- Gas for every settlement is the operator's, on both networks, with nothing coming back from the stakes.
- Two networks are two sets of keys, gas balances and alerts to run, for one person.
