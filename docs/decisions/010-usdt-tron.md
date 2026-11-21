# 010 — USDT on Tron: a third real-money network, the first outside EVM

**Date**: 2026-11-21 · **Decided by**: the owner · **Status**: proposed; the open questions below are the owner's ·
**Changes**: 003 FR-036 (one chain family → EVM plus Tron), FR-036c (a Tron token) · **Spec**:
`specs/007-usdt-tron/spec.md` · **Builds on**: 006-real-money, 007-escrow-v2

## The problem

Real money runs on Base and Arbitrum One, in USDC, plus USDT0 on Arbitrum One (003 FR-036a, FR-036c). Most of the
USDT people actually hold and move sits on Tron, in Tether's TRC-20 token. Someone with USDT on Tron today has to
bridge it to Arbitrum before they can stake, which is a step most will not take.

## The decision

Add **Tron mainnet** as a fourth real-money market, staked in **Tether's USDT (TRC-20)** only, on its own escrow
contract, worker key and offers, exactly as each EVM network is its own market (FR-036d). A Tron offer is matched
on Tron; a claim may carry stakes on Tron and on the EVM networks at once, and every stake settles with the same
verdict on the network it was opened on.

- **The same contract, compiled for Tron.** Tron runs Solidity on the TVM, which keeps `ecrecover`, `keccak256`
  and 20-byte addresses. EscrowV2 is deployed there with the same numbers (007: per side 1,000, per claim 10,000,
  per network 50,000, minimum 0.01, in USDT base units, 6 decimals), fee 0, ceiling 5%. Its constructor gains one
  rule: on Tron mainnet only Tether's USDT is accepted (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, to be checked against
  Tether's published address before deployment).
- **Testnet first.** Nothing is deployed to Tron mainnet before the contract has run end to end on **Nile**, Tron's
  testnet, with a test token that can block an address, as 006 requires of every network.
- **The wallet is TronLink.** The page talks to TronLink's injected `tronWeb`, not to `window.ethereum`; nothing is
  bundled, as on the EVM networks.
- **The worker gets a Tron adapter.** The settlement worker keeps one loop and one outbox; how a transaction is
  built, signed, sent and confirmed is per chain family. Tron's oracle key is its own, never an EVM one.
- **Addresses** are shown in Tron's own form (`T…`) on the page and the explorer is Tronscan; the contract and the
  database keep the 20-byte form.

## Why FR-036 changes

003 FR-036 says a second chain family is "a second verification path, a second toolchain and a second settlement
worker — not a configuration value". That stays true, and this record accepts it: Tron costs a second deployment
toolchain (Foundry cannot deploy to Tron), a second signing path in the page and in the worker, and a second set of
end-to-end runs. The owner judges the USDT held on Tron worth that (2026-11-21). The contract itself is not a second
one: the same source, the same tests on EVM, plus the Nile runs.

## Facts to check on Nile before anything else (each a HACK if it holds)

These decide whether the contract runs unchanged, and none is measured yet:

- **Does Tron's USDT `transfer` return `true`?** EscrowV2 credits a payment the token refuses (FR-036b). If the token
  returns nothing or `false` on success, every payout would be credited instead of sent. **UNRECONCILED.**
- **What `block.chainid` returns on the TVM**, and so what chain id the EIP-712 domain carries and what TronLink
  signs (TIP-712). **UNRECONCILED.**
- **Energy.** On Tron the sender pays in energy, not gas: a USDT transfer is about 65,000 energy to an address that
  holds USDT and about twice that to one that does not, which is several TRX when burned. **UNRECONCILED.** The
  worker makes every exit itself (FR-036b), so it pays for every payout and refund.

## Open questions (the owner's)

1. **Who pays the worker's energy?** The settlement worker sends every payout and refund. On Base that costs cents;
   on Tron one settlement can cost a few dollars of TRX. Options: the owner stakes TRX for energy (a fixed amount
   frozen, energy refills daily); rents energy per transaction; or Tron stakes get a higher minimum (for example
   10 USDT) so the cost is small beside the stake.
2. **The minimum stake on Tron**: 0.01 USDT as elsewhere, or higher for the reason above.
3. **Wallet linking** (003 FR-035, an X account shown beside an address): built for Tron addresses now, or Tron
   stakes shown by address only at first.
4. **A new dependency for the worker**: `tronpy` (Python, builds and signs Tron transactions), or Tron's HTTP API
   called directly with the signing the worker already has. AGENTS.md asks for approval of either.

## Accepted costs

- A second toolchain to deploy and verify the contract, and a second signing path in the page and the worker.
- TRX for the worker's energy, on top of the EVM networks' gas.
- Tether can freeze an address on Tron as Circle can on Base: the credit fallback (FR-036b) and the residual risks
  of FR-036e apply unchanged.

## Not changed

The verdict, the lock, the outbox, the caps, the guardian and the fee stay as 007 sets them. Base, Arbitrum One and
the USDT0 market on Arbitrum One are untouched.
