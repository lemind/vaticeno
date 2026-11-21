# Tasks: USDT on Tron

**Input**: `specs/007-usdt-tron/spec.md`, `plan.md`, `docs/decisions/010-usdt-tron.md`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Decision and facts

- [x] T701 ADR `docs/decisions/010-usdt-tron.md`; spec, plan and tasks under `specs/007-usdt-tron/`; 003 FR-036
  points to ADR 010; `.specify/feature.json` and `CLAUDE.md` name feature 007.
- [x] T702 Owner answers ADR 010: fees as on the other networks (worker burns TRX for exits), the other networks'
  minimum and caps, `tronpy` for the worker, wallet linking later.
- [ ] T703 `contracts/src/TronProbe.sol` (throwaway) on Nile, with Tether's test USDT
  (`TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`, its bytecode checked against mainnet's): `transfer`'s return value,
  `block.chainid`, a worker-signed EIP-712 digest recovered by the contract; mainnet's chain id read on mainnet;
  all into ADR 010, then the probe deleted (FR-004, FR-004a).

## Phase 2: Contract and deployment (US1, US2)

- [ ] T704 [US1] `contracts/src/EscrowV2.sol`: a payment counts as sent when the escrow's balance fell by its
  amount, in `_tryPush` and `_push` (FR-004); Tron mainnet accepts only Tether's USDT; any change T703 forces, as a
  tagged HACK. Foundry tests in `contracts/test/` with a token that returns `false` on success: paid, not credited;
  a refusal credited once; never both. The blocking test token (`contracts/src/TestUsdc.sol`) gets a mode that
  returns `false` on success, for Nile's blocked-address path. **Done 2026-11-21**: the balance check, the test
  token's mode and three Foundry tests; the Tron mainnet token rule waits for T703's chain id.
- [ ] T705 [US1] Tron `solc` pinned, reproducible artifact; `scripts/deploy-tron.py`: deploy with
  `consume_user_resource_percent = 100`, `origin_energy_limit` and `fee_limit` set, bytecode checked against the
  artifact (FR-004b); deploy to Nile.

## Phase 3: Worker (US2)

- [ ] T706 [US2] `settle/tron.py`: the `Escrow` methods through `tronpy` (added to the worker's requirements);
  energy and bandwidth costs in TRX and dollars into `cost_events` under a new `tron` provider: `COST_PROVIDERS`
  in `src/db/schema.ts` and a reversible migration (FR-007); tests in `settle/tests/`.
- [ ] T707 [US2] `settle/worker.py`: pick the adapter by the network's family; each network in its own step with its
  own timeout, so a Tron outage or `OUT_OF_ENERGY` is retried without holding up other networks (FR-006); tested.

## Phase 4: Page (US1)

- [ ] T708 [P] [US1] `src/wager/networks.ts` and `src/config.ts`: chain family, Nile and Tron mainnet, `T…` addresses
  in `WAGER_NETWORKS`.
- [ ] T709 [US1] `src/web/wallet.js` and `src/web/wager-page.ts`: TronLink path, `T…` addresses, Tronscan links,
  the wrong-network refusal (FR-005); zero-first approval when an old allowance is left (FR-004c); `fee_limit` on
  every call.
- [ ] T710 [US1] `src/replies/templates.ts`: the wager reply's money line names Tron (FR-011).

## Phase 5: Proof and launch (US2, US3)

- [ ] T711 [US2] `scripts/e2e_tron.py`: every path of FR-003 on Nile; a Tron and an EVM offer on one claim, never
  matched together and settled apart; Tron's node unreachable while EVM stakes settle; a repeated approval after a
  failed open (SC-001). The EVM side is Base Sepolia's v2 escrow (003 T379) in the run's own configuration.
- [ ] T711a [US2] `scripts/estimate-tron.py`: each escrow call's energy and bandwidth estimated against mainnet USDT;
  the numbers into ADR 010 (FR-007, SC-002).
- [ ] T712 [US3] `settle/health.py` and the status page: Tron's totals, the oracle's TRX, low-balance alert (FR-008).
- [ ] T713 Incident policy (`docs/settlement-policy.md`) covers Tron, Tether's switchable fee among its known risks; deploy EscrowV2 to Tron mainnet; `WAGER_NETWORKS` on the server; README and
  CHANGELOG.

## Dependencies

T703 before T704; T704–T705 before T706–T711; T711, T711a and T712 before T713.
