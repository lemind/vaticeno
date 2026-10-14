# 002 — Escrow v1: what the contract settles before it exists

**Date**: 2026-10-14 · **Decided by**: the owner · **Status**: proposed — the numbers below are drafts until
the owner signs them off · **Answers**: 003 FR-031f and FR-031h, before any Solidity (SC-019)

A deployed contract gains nothing later. Every item here is answered in version one or deliberately absent.

## Chosen

| | Choice | Why |
|---|---|---|
| Toolchain | **Foundry** | tests in Solidity with fuzzing and time warp, which the window and timeout tests need; a binary, not an npm or pip dependency |
| Network | **Base Sepolia** (chain id 84532) | cheap, dependable faucets, public source verification (T330) |
| Stake token | **our own test ERC-20**, 18 decimals, mintable by the deployer | no faucet to run dry mid-test; exercises the same token path a stablecoin would |

## The numbers — proposed

All fixed at deployment as immutable constructor arguments: nobody can change them per stake or later.

| Number | Proposed | Why |
|---|---|---|
| Settlement window (verdict → payout callable) | **72 hours** | a price verdict is checkable in a minute, but someone has to look; three days covers a weekend. The weekly recheck does not fit inside it, so a staked claim is rechecked by the TypeScript side before its outbox row is written — the worker never re-judges (001-second-runtime) |
| Timeout (deadline → refund callable, if never settled) | **14 days** | a daily close is decided within a day; two weeks absorbs a long source outage, which must never become a payout (INIT_SPEC §6.7) |
| Acceptance closes | **24 hours before the deadline** | a price claim accepted minutes before its close is a bet on information, not a disagreement |
| Unmatched offer expires | **7 days after opening, or when acceptance closes**, whichever is first | the maker's money never waits on a stranger for long |
| Maximum stake per side | **100 test tokens** | the cap must exist from the first deployment (FR-022); the value matters only on a real network |
| Fee | **0**, ceiling **5%** in code | zero on the testnet; the ceiling is a constant, so no deployment can set more |

The end-to-end run (T337) uses a second, throwaway deployment with the window and timeout in minutes. The
deployment whose address is published keeps the numbers above.

## FR-031f, item by item

| Item | Answer |
|---|---|
| One terminal state, no double settlement | a stake ends in exactly one of `expired`, `paid`, `voided`, `refunded`; every transition requires the state before it |
| Permissionless payout after the window | `payout` is callable by anyone once `settledAt + window` has passed; it sends the pot to the winning side |
| The void path | `void` by the oracle or the guardian, only inside the window; it returns each side its own stake and nothing else (FR-031c) |
| The timeout refund | `refund` by anyone once `deadline + timeout` has passed and the stake was never settled (FR-030) |
| Unmatched expiry | `expire` by anyone after the offer's expiry; the maker gets the full amount back |
| Maximum stake | enforced at `open` |
| Fee ceiling and recipient | fee in basis points and its recipient are immutable; no withdrawal function of any kind exists |
| Oracle key lost | nothing can settle, so every stake reaches its timeout and refunds itself. A new contract with a new oracle is the recovery; the old one drains through refunds |
| Oracle key compromised | the attacker can settle wrongly, so a **guardian** key — held offline, separate from the oracle — may void during the window and stop new stakes. It cannot pay anyone. Loss is bounded by the maximum stake and by how fast the guardian acts |
| Stopping new stakes without blocking refunds | the guardian's `pause` stops `open` and `accept` only; `payout`, `void`, `refund` and `expire` always work |
| Events for auditing from the chain alone | `Opened`, `Accepted`, `Settled(outcome, evidenceRef)`, `Paid`, `Voided(reasonCode, evidenceRef)`, `Refunded`, `Expired`, `Paused`, `Unpaused` |

**Sides.** The maker chooses HIT or MISS at `open`; the taker takes the other. A VOID verdict settles as a
refund of both stakes, never a payout.

**Opening needs the oracle's authorization** (FR-031a): an EIP-712 signature over the claim hash, the deadline
and the offer's expiry, issued only for a price-feed claim. Without it the rule would hold only on our page.

**On-chain, no text** (FR-023): the claim hash is the hash of the claim id and its locked contract hash;
`evidenceRef` is the hash of the stored resolution evidence; reason codes are `1` wrong source value,
`2` resolver defect, `3` evidence fails the locked contract (FR-031e).

## FR-031h — real value

Not answered, on purpose: this deployment is a testnet and carries none. Real value needs a legal opinion for
the operator's country, an independent reading of the contract, and a written incident policy. None of the
three is in this feature.

## Still the owner's

- Sign off or correct the six numbers.
- Where the guardian key lives, and who can act on it out of hours — its speed is what bounds a compromise.
- `web3.py` for the worker (T333) and an EVM library for link signatures (T339b): approval with a reason (VII).
