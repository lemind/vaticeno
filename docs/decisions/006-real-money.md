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
count on its own. The legal opinion meant to answer it (T380) was dropped on 2026-10-29: the owner launches the
no-fee version and carries that risk. A fee of any kind, a flat per-stake one being the only form considered, is
a new, dated owner decision and reopens constitution VII.

## Constitution VII

VII lists payments among the things deliberately absent until justified. Read as it was written — a payment
system, money collected from users for a service (the Stripe kind, also listed as absent in AGENTS.md) — the
no-fee escrow is not one: it takes nothing and charges nothing, and every transfer is a user's own, signed in
their own wallet. So VII is not changed by this decision. A non-zero fee would be money collected from users,
and it reopens VII: it needs this file amended and the constitution's own amendment process.

## What gates it

Nothing is deployed to a mainnet before v2 has run end to end on its testnet and the written incident policy is
on file (003 SC-024). **Amended 2026-10-29 (owner)**: the legal opinion and the outside review of the contract
are no longer gates. Stakes are small and there are no users yet; the risk is the owner's, bounded by the
contract's caps, and either can still be asked for later. The order and the work are in 003 tasks Phase 8.

## Accepted costs

- No revenue from wagers. The account's other ways to earn (none built yet) carry it, or nothing does.
- Gas for every settlement is the operator's, on both networks, with nothing coming back from the stakes.
- Two networks are two sets of keys, gas balances and alerts to run, for one person.
