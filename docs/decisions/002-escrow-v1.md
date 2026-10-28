# 002 — Escrow v1: what the contract settles before it exists

**Date**: 2026-10-14 · **Decided by**: the owner · **Status**: accepted 2026-10-14, numbers and guardian key
included · **Answers**: 003 FR-031f and FR-031h, before any Solidity (SC-019)

A deployed contract gains nothing later. Every item here is answered in version one or deliberately absent.

## Chosen

| | Choice | Why |
|---|---|---|
| Toolchain | **Foundry** | tests in Solidity with fuzzing and time warp, which the window and timeout tests need; a binary, not an npm or pip dependency |
| Network | **Base Sepolia** (chain id 84532) | cheap, dependable faucets, public source verification (T330) |
| Stake token | **our own test ERC-20**, 18 decimals, mintable by the deployer | no faucet to run dry mid-test; exercises the same token path a stablecoin would |

## The numbers

All fixed at deployment as immutable constructor arguments: nobody can change them per stake or later.

| Number | Proposed | Why |
|---|---|---|
| Settlement window (verdict → payout callable) | **72 hours** | a price verdict is checkable in a minute, but someone has to look; three days covers a weekend. The weekly recheck does not fit inside it, so a staked claim is rechecked by the TypeScript side before its outcome is set on the outbox row — the worker never re-judges (001-second-runtime) |
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
| The void path | `voidStake` by the oracle or the guardian, only inside the window; it returns each side its own stake and nothing else (FR-031c) |
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
and how long the authorization holds, bound to this contract and chain. The worker signs it once per price-feed
claim when the claim locks, valid until acceptance closes; every stake on the claim reuses it, since it says
the claim is eligible, not that one stake is. The offer's own expiry is computed by the contract, not signed.
`stakesOf(claimHash)` lists a claim's stakes, so the worker settles all of them from the claim alone.

**On-chain, no text** (FR-023): the claim hash is the keccak-256 of the claim's slug, computed in one place (data-model);
`evidenceRef` is the hash of the stored resolution evidence; reason codes are `1` wrong source value,
`2` resolver defect, `3` evidence fails the locked contract (FR-031e).

## FR-031h — real value

Not answered here, on purpose: this deployment is a testnet and carries none, and v1 never goes to a mainnet.
Real value is 003's Stage 4 with contract v2 (docs/decisions/006-real-money.md), gated on a legal opinion that
says go, an independent review of the release commit and a written incident policy (003 FR-031h, SC-024).

## Still the owner's

- Where the guardian key lives, and who can act on it out of hours — its speed is what bounds a compromise.
- `web3.py` for the worker (T333) and an EVM library for link signatures (T339b): approval with a reason (VII).

## Before real value (added 2026-10-21)

Version one stays on Base Sepolia as it is. The contract that holds real value is a second version, built
after the network is chosen (003 T374, T376):

| Change | Why |
|---|---|
| **Pull, not push** (003 FR-036b): every exit credits a balance, each beneficiary calls `withdraw()` | today `payout` and `_refundBoth` send to two addresses in one transaction; if the token refuses one (USDC can block an address), the call reverts and the other side's money is stuck with it |
| **Native USDC only, one fixed address** (003 FR-036c): Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Arbitrum One `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | the escrow assumes it received exactly `amount`, which is false for a fee-on-transfer or rebasing token; bridged USDC is a different token |
| **Cap in 6-decimal base units**: 100 USDC = `100_000_000` | the test token has 18 decimals; copying `100e18` would allow a 10¹⁴ USDC stake |

**Residual risk, accepted in writing**: pull payments keep one blocked address from freezing the other, but a
blocked address cannot withdraw its own balance while USDC blocks it. USDC's pause, blocklist and upgrade
controls belong to Circle and go into the real-value risk assessment (003 FR-031h).
