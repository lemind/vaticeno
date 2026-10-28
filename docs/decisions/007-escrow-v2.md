# 007 — Escrow v2: the contract that holds real USDC

**Date**: 2026-10-28 · **Decided by**: the owner · **Status**: first draft (003 T378); numbers and keys accepted
2026-10-28; amended after the legal opinion (T378a) · **Answers**: 003 FR-031f again for real value, FR-022a,
FR-022b, FR-036b–e · **Builds on**: 002-escrow-v1, 006-real-money

Version one stays on Base Sepolia, unchanged. Version two is the contract that holds real money, on Base and
Arbitrum One. Like v1, every number is fixed at deployment: a deployed contract gains nothing later, so raising
a cap or setting a fee is a new deployment and a new decision. This record lists only what differs from 002;
everything it does not mention is v1's.

## The numbers

All in USDC base units (6 decimals: 1 USDC = `1_000_000`), immutable constructor arguments.

| Number | v2 | v1 | Why |
|---|---|---|---|
| Maximum per side of a stake | **1,000 USDC** (`1_000_000_000`) | 100 test tokens | owner, 2026-10-28 |
| Maximum per claim | **10,000 USDC** (`10_000_000_000`) | none | one wrong verdict moves at most this much |
| Maximum per network | **50,000 USDC** (`50_000_000_000`) | none | what the contract holds in live stakes while it is new |
| Minimum stake | **1 USDC** (`1_000_000`) | none | below it, gas costs more than the stake |
| Fee | **0**, ceiling **5%** as a constant | the same | 006-real-money: no fee at launch |
| Settlement window | **72 hours** | the same | |
| Timeout | **14 days** | the same | |
| Acceptance closes | **24 hours before the deadline** | the same | |
| Unmatched offer expires | **7 days, or when acceptance closes** | the same | |

**What the caps count.** Money held for live stakes: an open offer counts its amount, a matched stake twice its
amount. The claim's total and the network's total rise at `open` and `accept` and fall when a stake leaves
(paid, voided, refunded, expired). Balances already credited and waiting to be withdrawn do not count: they are
owed, not at stake. `open` and `accept` both refuse a stake that would take the claim or the network past its
cap, so the cap holds however many offers are made. The constructor refuses a configuration where the per-side
cap times two exceeds the per-claim cap, or the per-claim cap exceeds the per-network one.

**The fee, when it is not zero.** `fee = floor(pot × feeBps / 10_000)`, `pot = 2 × amount`; the winner is credited
`pot − fee`, the fee recipient `fee`. Rounding is down, so any remainder goes to the winner. No refund path —
VOID, the guardian's void, the timeout, an expired offer — ever takes a fee.

## What changes in the contract

| Change | v1 | v2 |
|---|---|---|
| **Pull, not push** (FR-036b) | `payout` and the refunds send tokens to one or two addresses in the same call | every exit **credits** a balance; each address calls `withdraw()` for its own credit, in its own transaction. A blocked maker never stops the taker, and a blocked fee recipient never stops either |
| **The token** (FR-036c) | any ERC-20 named at deployment | native USDC: on chain 8453 the constructor accepts only `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, on chain 42161 only `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; on a testnet any token, so the blocking test token can stand in |
| **Caps** (FR-022a) | one per-stake maximum | per side, per claim and per network, as above, plus the minimum |
| **Withdrawal** | "no withdrawal function of any kind exists" | one: `withdraw()`, which moves only the caller's own credited balance. Still no function moves anyone else's money |
| **Events** | as 002 | adds `Credited(account, stakeId, amount)` and `Withdrawn(account, amount)`, so every balance can be audited from the chain alone |
| **Views** | `stakesOf` | adds `creditOf(address)`, `lockedOnClaim(claimHash)`, `lockedTotal()`, `creditTotal()` (so what it owes is
`lockedTotal + creditTotal`), for the page and the worker's health row (FR-022c) |
| **Signature version** | the worker signs `"1"` | the worker signs `"2"`. `ESCROW_VERSION` (1 or 2, default 1) tells the page and the worker which contract they face; the worker refuses to start when the contract's own domain is not that version |

Unchanged from v1, and named because the review checks them: the EIP-712 authorization is bound to the chain
id and the contract address, so one network's authorization is refused on the other; the seven transitions and
their order; the guardian's `pause` stopping only `open` and `accept`, never an exit; the oracle settling and
nobody else.

## Keys and wallets

Public addresses only are ever written down; no private key or recovery phrase is in this repo, a decision record
or a chat.

| Role | Per network? | Who holds it | Notes |
|---|---|---|---|
| **Oracle** | **one per network**, new | the server, in the settlement worker's own file (`/etc/vaticeno-settle/`, mode 600) | never the testnet key; generated on the owner's machine and copied once, like v1's |
| **Guardian** | one address, both networks | **the owner only**: a separate wallet used for nothing else, ideally hardware | acts **within 24 hours** of an alert, inside the 72-hour window: pause new stakes, void a wrong verdict |
| **Fee recipient** | one address, both networks | the owner: a new wallet | required even at 0%, and fixed for the contract's life |
| **Deployer** | new | the owner's machine | holds no power after deployment: every setting is immutable |

**If a key goes:** oracle lost — nothing settles, every stake refunds itself at the timeout, and a new contract
with a new oracle replaces it. Oracle compromised — the guardian pauses new stakes and voids anything settled
wrongly inside the window; the loss is bounded by the per-claim and per-network caps and by how fast the guardian
acts. Guardian lost — nothing can be paused or voided any more; the contract keeps running, and the next
deployment gets a new guardian. These are the cases 003 T382's incident policy turns into a procedure.

## Waiting for the legal opinion (T378a)

Left open on purpose until the lawyer answers (003 T380), because each may change the contract:

- **Who may open an offer.** Today anyone holding the claim's authorization can call the contract directly, so
  blocking a country on the page alone blocks nothing. If the opinion requires it, the authorization becomes
  per address, signed only after a check — a change to `open` and to the worker.
- **Which countries**, and whether that is enforced on the page, in the authorization, or both.
- **A fee**: whether a flat per-stake fee, charged to both sides whatever the outcome, would change the answer.
- **Any KYC or AML threshold** at these amounts.

## Testnet deployments

Base Sepolia and Arbitrum Sepolia get v2 with the numbers above and a test token that can block an address (003
T379). The end-to-end runs use a second, throwaway deployment with the window, the timeout and the offer
lifetime in minutes, as v1's did; the deployment whose address is published keeps the real numbers.
