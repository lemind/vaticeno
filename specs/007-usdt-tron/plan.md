# Implementation Plan: USDT on Tron

**Branch**: `usdt-tron` | **Date**: 2026-11-21 | **Spec**: `specs/007-usdt-tron/spec.md` | **ADR**: `docs/decisions/010-usdt-tron.md`

## Summary

A fourth real-money market: EscrowV2 deployed on Tron, staked in Tether's TRC-20 USDT. The contract source stays one;
what is new is per chain family: deploying to Tron, the page's wallet (TronLink instead of `window.ethereum`), and
the worker's transaction path (Tron instead of web3). Nile first, mainnet after its end-to-end run.

## Constitution check

| Principle | How it holds |
|---|---|
| II Checkable by construction | the verdict and the outbox are unchanged; Tron stakes settle with the claim's one verdict |
| III An outage is never a verdict | a Tron node or energy outage is retried; no other network waits for Tron |
| V IDs, not text | nothing new is stored but addresses, transaction ids and costs |
| VII Boring by design | a second chain family is a second toolchain (003 FR-036, accepted in ADR 010); one new dependency, `tronpy`, approved by the owner (ADR 010) |

## Design

- **Contract** `contracts/src/EscrowV2.sol`: the constructor's token rule gains Tron mainnet → Tether's USDT only
  (the 20-byte form of `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`), once Nile has shown what `block.chainid` returns
  there. Any change for USDT's `transfer` return value waits for the Nile measurement (FR-004) and is a tagged HACK.
  Foundry tests run as today, plus one for the Tron chain id rule.
- **Deploy** `scripts/deploy-tron.py` (new): deploys the Foundry-compiled bytecode to Nile or mainnet through Tron's
  HTTP API, with the constructor arguments of `scripts/deploy-v2.sh`; prints the address in both forms.
  `scripts/e2e_tron.py` (new): the end-to-end paths of FR-003 on Nile, as `scripts/e2e_v2.py` does for EVM.
- **Networks** `src/wager/networks.ts`: `KnownNetwork` gains `family: 'evm' | 'tron'`; Nile and Tron mainnet join
  `KNOWN_NETWORKS` (Tronscan, TronGrid nodes, USDT on mainnet). `WAGER_NETWORKS` entries for Tron take `T…`
  addresses, stored hex. `src/config.ts` parses both.
- **Page** `src/web/wallet.js`: a Tron path beside the EVM one — TronLink's `tronWeb` for the account, the
  network check, `approve`, `open`, `accept` and `withdraw`; reads through TronGrid. `src/web/wager-page.ts`
  shows Tron addresses as `T…` and links Tronscan.
- **Worker** `settle/tron.py` (new): the same methods as `settle/chain.py`'s `Escrow` (`sign_open`, `stakes_of`,
  `send_settle`, `send_finish`, `wait_mined`, `in_flight`, `holdings`) through `tronpy`, energy paid by burning
  TRX; `settle/worker.py` picks the adapter by the network's family. The oracle key for Tron lives in `/etc/vaticeno-settle/` like the
  others. Costs (TRX burned, energy used) go to `cost_events` as the EVM gas does.
- **Health** `settle/health.py`: Tron's totals, the oracle's TRX and energy, a low-balance alert.
- **Wager reply** `src/replies/templates.ts`: the money line names Tron when the page offers it.

## Order

1. Measure on Nile (FR-004): USDT-like token return value, `block.chainid`, TIP-712 signing in TronLink, energy per
   transfer. Write the numbers into ADR 010.
2. Contract rule and deploy script; deploy to Nile.
3. Worker adapter, then page; the Nile end-to-end run (FR-003).
4. Mainnet deployment. Wallet linking for Tron is later work.

## Tests

- Foundry: the Tron constructor rule; everything else as today.
- Python: the Tron adapter against a stubbed `tronpy` client (settle, finish, a refused transfer credited, an outage
  retried).
- The Nile end-to-end run is the proof (SC-001), as the Base and Arbitrum Sepolia runs were.
