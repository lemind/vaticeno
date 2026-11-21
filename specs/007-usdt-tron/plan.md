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

- **Contract** `contracts/src/EscrowV2.sol`: `_tryPush` and `_push` judge a payment by the escrow's balance before
  and after the call, not by the returned value (FR-004); the constructor's token rule gains Tron mainnet →
  Tether's USDT only (the 20-byte form of `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`), keyed to mainnet's chain id as
  read on mainnet. Foundry tests: a token that returns `false` on success (new, in `contracts/test/`), the blocking
  token made to return `false` too, never paid and credited, the Tron chain id rule.
- **Probe** `contracts/src/TronProbe.sol` (new, throwaway, Nile only): returns `block.chainid`, recovers a
  worker-signed EIP-712 digest, and calls USDT's `transfer` to report what it returns (FR-004a). Deleted once its
  numbers are in ADR 010.
- **Build**: Tron's `solc` at a pinned version with the optimizer settings of `contracts/foundry.toml`; the artifact
  is reproducible and recorded by hash, and the deploy checks the bytecode on chain against it (FR-004b).
- **Deploy** `scripts/deploy-tron.py` (new, `tronpy`): deploys that artifact to Nile or mainnet with the constructor
  arguments of `scripts/deploy-v2.sh`, `consume_user_resource_percent = 100`, a set `origin_energy_limit` and an
  explicit `fee_limit`; prints the address in both forms. `scripts/estimate-tron.py` (new): read-only energy and
  bandwidth estimates of open, accept, settle, payout and refund against mainnet USDT (FR-007).
  `scripts/e2e_tron.py` (new): the end-to-end paths of FR-003 on Nile, as `scripts/e2e_v2.py` does for EVM.
- **Networks** `src/wager/networks.ts`: `KnownNetwork` gains `family: 'evm' | 'tron'`; Nile and Tron mainnet join
  `KNOWN_NETWORKS` (Tronscan, TronGrid nodes, USDT on mainnet). `WAGER_NETWORKS` entries for Tron take `T…`
  addresses, stored hex. `src/config.ts` parses both.
- **Page** `src/web/wallet.js`: a Tron path beside the EVM one — TronLink's `tronWeb` for the account, the
  network check, `approve` (zero first when an old allowance is left, FR-004c), `open`, `accept` and `withdraw`,
  each with an explicit `fee_limit`; reads through TronGrid. `src/web/wager-page.ts`
  shows Tron addresses as `T…` and links Tronscan.
- **Worker** `settle/tron.py` (new): the same methods as `settle/chain.py`'s `Escrow` (`sign_open`, `stakes_of`,
  `send_settle`, `send_finish`, `wait_mined`, `in_flight`, `holdings`) through `tronpy`, energy paid by burning
  TRX, an explicit `fee_limit` on every call, `OUT_OF_ENERGY` retried. `settle/worker.py` picks the adapter by the
  network's family; each network is already its own worker process. The oracle key for Tron lives in
  `/etc/vaticeno-settle/` like the others. Costs (energy and bandwidth, as TRX burned) go to `cost_events` under
  the new `tron` provider: `COST_PROVIDERS` in `src/db/schema.ts` and a reversible migration for
  `cost_events_provider_check`.
- **Health** `settle/health.py`: Tron's totals, the oracle's TRX, a low-balance alert.
- **Wager reply** `src/replies/templates.ts`: the money line names Tron when the page offers it.

## Order

1. The probe contract on Nile with Tether's test USDT: `transfer`'s return value, `block.chainid`, the worker's
   EIP-712 digest recovered by the contract; mainnet's chain id read on mainnet (FR-004, FR-004a). Into ADR 010.
2. The balance-checked payment and the Tron token rule, with their Foundry tests.
3. Tron build and deploy script; deploy to Nile.
4. Worker adapter, then page; the Nile end-to-end run with the cross-network and outage tests (SC-001).
5. Mainnet estimates (FR-007), health and alerts (FR-008), then mainnet. Wallet linking for Tron is later work.

## Tests

- Foundry: a payment judged by balance (`false` on success is paid; a refusal credited once; never both); the Tron
  constructor rule; everything else as today.
- Python: the Tron adapter against a stubbed `tronpy` client (settle, finish, a refused transfer credited, an outage
  and `OUT_OF_ENERGY` retried); a stalled Tron network does not delay an EVM one.
- Page: an old non-zero allowance is set to 0 before the new one.
- The Nile end-to-end run is the proof (SC-001), as the Base and Arbitrum Sepolia runs were; its EVM side is Base
  Sepolia's v2 escrow, in the run's own configuration.
