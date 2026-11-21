# 010 — USDT on Tron: a third real-money network, the first outside EVM

**Date**: 2026-11-21 · **Decided by**: the owner · **Status**: accepted 2026-11-21 ·
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

- **The same contract, compiled for Tron, with one change** (below: how a payment is judged sent). Tron runs
  Solidity on the TVM, which keeps `ecrecover`, `keccak256` and 20-byte addresses. EscrowV2 is deployed there with the same numbers (007: per side 1,000, per claim 10,000,
  per network 50,000, minimum 0.01, in USDT base units, 6 decimals), fee 0, ceiling 5%. Its constructor gains one
  rule: on Tron mainnet only Tether's USDT is accepted (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, to be checked against
  Tether's published address before deployment).
- **Testnet first.** Nothing is deployed to Tron mainnet before the contract has run end to end on **Nile**, Tron's
  testnet, as 006 requires of every network. Two tokens there: Tether's own test USDT, to prove the escrow copes
  with its `transfer`, and our own test token that returns `false` the same way and can also block an address,
  for the blocked-address path, which only Tether could set up on its token.
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
one: the same source (with the payment check below, which suits every token), the same tests on EVM, plus the
Nile runs.

## Tron's USDT returns `false` from a transfer that worked (review 2026-11-21)

Documented by OpenZeppelin for TRON: Tether's TRC-20 `transfer` moves the tokens and returns `false`; `transferFrom`
and `approve` return `true`. In EscrowV2 as it stands, `_tryPush` reads `false` as "refused" and credits the
person after the money has already gone out: every payout is also booked as a credit, so the escrow appears to owe
far more than it holds, and `withdraw` (`_push`, which requires `true`) always reverts, so no credit, real or
phantom, can ever be taken out. So the contract changes before Tron:

- **A payment counts as sent when the escrow's own balance fell by exactly its amount**, read before and after the
  call, whatever the token returns (the pattern of OpenZeppelin's `SafeTRC20.safeTransferChecked`). A call that
  reverts or leaves the balance unchanged is a refusal and is credited, once. `withdraw` uses the same check.
- The change is in the source both families share. Base's and Arbitrum's deployed contracts are immutable and stay
  as they are (USDC returns `true`); a later EVM deployment carries the check too, which is still correct.
- Tests: a token that returns `false` on success (paid, not credited); a blocked address (credited once); never
  both paid and credited, never credited twice. On Nile, Tether's test USDT (`TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`,
  said to share mainnet USDT's bytecode, which is checked first) for the payments, and our blocking test token
  for the blocked path; never a token that returns `true`.

## Measured on mainnet, 2026-11-21 (read-only calls, nothing sent)

Simulated with TronGrid's `triggerconstantcontract` from a real USDT holder, and read from `getchainparameters`,
`getcontractinfo` and the nodes' `eth_chainId`:

| What | Measured |
|---|---|
| USDT `transfer` of 1 USDT that succeeds | returns **`0` (false)**: the finding above, confirmed on mainnet itself |
| USDT `approve` | returns `1` (true) |
| Energy of one USDT transfer, to an address that holds USDT | **64,285** (49,635 of it the dynamic penalty) |
| Energy of one USDT transfer, to an address that holds none | **130,285** (100,635 penalty) |
| Energy of an `approve` to a new spender | **99,764** |
| USDT's dynamic energy factor | **34,000**, the maximum (×4.4 energy) |
| Price of energy when no TRX is staked | 100 sun (0.0001 TRX) per unit |
| Chain id the nodes report | mainnet `0x2b6653dc` (728126428), Nile `0xcd8690dc` (3448148188) |

So, in TRX burned, before the escrow's own logic (measured once it is deployed on Nile):

- **Our worker, per stake**: a payout is one transfer, **6.4–13 TRX**; a refund (VOID, timeout) is two, **13–26 TRX**;
  the `settle` call itself adds its own energy, to be measured.
- **The person, per side**: an approval about **10 TRX**, then the stake (`transferFrom` into the escrow plus the
  escrow's bookkeeping) likely as much again. On Base the same costs cents. Dollars wait for a TRX price, which the
  worker does not fetch (`TRX_USD` in its env). **UNRECONCILED** until the Nile deployment measures the escrow's
  own calls and the first mainnet receipts confirm them.

## Measured on Nile, 2026-11-21 (the probe contract, `TX1kATkE5RTpptT8BgmPXnX33v6rZJRANR`)

- **`block.chainid` inside a contract** is 3448148188, the node's own chain id, so mainnet's is taken as its node's,
  728126428, the value EscrowV2's Tron rule uses.
- **`ecrecover` of the worker's EIP-712 signature**, built with that chain id and the contract's 20-byte address,
  returns the oracle's address: the open authorization works on Tron unchanged.
- **Tether's test USDT** (`TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`) has exactly mainnet USDT's bytecode (15,575 bytes,
  same hash), and called from inside a contract its successful `transfer` returns 32 bytes of `false`.
- Deploying the 895-byte probe burned 18.3 test TRX (169,255 energy); Nile's energy is not mainnet's, as above.

## Facts still to measure

- **The escrow's own energy** for open, accept, settle, payout and refund, once it is on Nile, estimated against
  mainnet's factor as above. **UNRECONCILED.** The worker makes every exit itself (FR-036b), so it pays for every
  payout and refund.

## How the contract is built and called on Tron

- **Compiler**: Tron's own `solc`, at a pinned version and with the EVM build's optimizer settings, not upstream
  `solc`. The artifact is reproducible from the repo, and the deployed bytecode is checked against it.
- **Energy settings**: deployed with the caller paying all of a call's energy (`consume_user_resource_percent =
  100`; the deployer subsidises nothing, `origin_energy_limit` set to match). Every call from the page and the
  worker carries an explicit `fee_limit` (Tron's HTTP API defaults it to 0). A call that runs out of energy
  (`OUT_OF_ENERGY`) is a failed transaction the worker retries, never a verdict.
- **Which Tron network TronLink is on**: TronLink names no chain id, so the page tells Nile from mainnet by its node's
  host; a SPECULATIVE HACK in `src/web/wallet.js`, checked on the Nile run.
- **Approvals**: one approval for all later stakes, since each costs about 10 TRX (owner, 2026-11-21); the escrow
  only ever takes from the wallet that calls it. Tron's USDT refuses to change a non-zero allowance straight to
  another non-zero one, so a leftover smaller one is set to 0 first, then raised. On EVM nothing changes.
- **Isolation**: each network's worker is its own process (003 FR-036d), so a slow or unreachable Tron node never
  holds up a stake on Base or Arbitrum. The Nile run proves it beside Base Sepolia's v2 escrow (deployed 2026-11-01,
  003 T379), set in the run's own configuration; production's networks are not touched.
- **Costs**: the worker's TRX per transaction (energy and bandwidth) is recorded in `cost_events` under a new
  `tron` provider (a migration); EVM gas is not recorded today and is not added by this feature.

## Answered (owner, 2026-11-21)

1. **Fees are paid as on the other networks.** Each person's wallet pays for what it sends (approve, open, accept,
   withdraw: 003 FR-042), and the worker pays for the verdict and every exit at our cost (FR-036b). On Tron that cost
   is TRX burned for energy, the way gas is paid in ETH elsewhere; nothing is staked or rented, so the oracle holds
   TRX, not energy. Its TRX gets a low-balance alert like its gas does (003 FR-022c).
2. **The numbers are the other networks' numbers**: minimum 0.01, per side 1,000, per claim 10,000, per network
   50,000 USDT (007). Nothing new is invented for Tron.
3. **`tronpy`** is the worker's one new dependency (Python, builds and signs Tron transactions; approved as the
   usual way to do it).
4. **Wallet linking later** (003 FR-035, an X account shown beside an address): Tron stakes are shown by address
   only at launch; linking Tron addresses is later work.

## Accepted costs

- A second toolchain to deploy and verify the contract, and a second signing path in the page and the worker.
- TRX for the worker's energy, on top of the EVM networks' gas: 6.4–26 TRX of transfers per settled stake, measured
  above, plus the escrow's own calls (**UNRECONCILED** until the Nile deployment, T711a), against cents on Base.
- People staking on Tron pay more than on Base too: about 10 TRX to approve, and the stake itself.
- Tether can freeze an address on Tron as Circle can on Base: the credit fallback (FR-036b) and the residual risks
  of FR-036e apply unchanged.
- Tether's USDT has a transfer fee its owner can switch on; it is zero today. If it were switched on, a deposit
  would arrive short of the stake it records. Accepted as a known risk (owner, 2026-11-21), written into the
  settlement policy; nothing is built for it.

## Not changed

The verdict, the lock, the outbox, the caps, the guardian and the fee stay as 007 sets them. Base, Arbitrum One and
the USDT0 market on Arbitrum One are untouched.
