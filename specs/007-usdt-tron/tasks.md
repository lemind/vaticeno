# Tasks: USDT on Tron

**Input**: `specs/007-usdt-tron/spec.md`, `plan.md`, `docs/decisions/010-usdt-tron.md`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Decision and facts

- [x] T701 ADR `docs/decisions/010-usdt-tron.md`; spec, plan and tasks under `specs/007-usdt-tron/`; 003 FR-036
  points to ADR 010; `.specify/feature.json` and `CLAUDE.md` name feature 007.
- [x] T702 Owner answers ADR 010: fees as on the other networks (worker burns TRX for exits), the other networks'
  minimum and caps, `tronpy` for the worker, wallet linking later.
- [ ] T703 On Nile: a TRC-20 test token like Tether's, then measure `transfer`'s return value, `block.chainid`,
  TronLink's TIP-712 signature against the contract's domain, and energy per transfer; write them into ADR 010
  (FR-004).

## Phase 2: Contract and deployment (US1, US2)

- [ ] T704 [US1] `contracts/src/EscrowV2.sol`: Tron mainnet accepts only Tether's USDT; any change T703 forces, as
  a tagged HACK; Foundry tests in `contracts/test/`.
- [ ] T705 [US1] `scripts/deploy-tron.py`: deploy the compiled contract to Nile or mainnet; deploy to Nile.

## Phase 3: Worker (US2)

- [ ] T706 [US2] `settle/tron.py`: the `Escrow` methods through `tronpy` (added to the worker's requirements);
  costs in TRX and dollars (FR-007); tests in `settle/tests/`.
- [ ] T707 [US2] `settle/worker.py`: pick the adapter by the network's family; a Tron outage retried without holding
  up other networks (FR-006).

## Phase 4: Page (US1)

- [ ] T708 [P] [US1] `src/wager/networks.ts` and `src/config.ts`: chain family, Nile and Tron mainnet, `T…` addresses
  in `WAGER_NETWORKS`.
- [ ] T709 [US1] `src/web/wallet.js` and `src/web/wager-page.ts`: TronLink path, `T…` addresses, Tronscan links,
  the wrong-network refusal (FR-005).
- [ ] T710 [US1] `src/replies/templates.ts`: the wager reply's money line names Tron (FR-011).

## Phase 5: Proof and launch (US2, US3)

- [ ] T711 [US2] `scripts/e2e_tron.py`: every path of FR-003 on Nile; the run's results and costs in ADR 010
  (SC-001, SC-002).
- [ ] T712 [US3] `settle/health.py` and the status page: Tron's totals, TRX and energy, low-balance alert (FR-008).
- [ ] T713 Incident policy covers Tron; deploy EscrowV2 to Tron mainnet; `WAGER_NETWORKS` on the server; README and
  CHANGELOG.

## Dependencies

T703 before T704; T704–T705 before T706–T711; T711 before T713.
