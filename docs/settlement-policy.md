# Settlement policy

**Today: testnet only.** Stakes are a test token worth nothing, on Base Sepolia. No real money is accepted.

**Next: real money in USDC, on Base first, then Arbitrum One.** It goes live once the new contract has run end
to end on a testnet. This document already describes how it works, so the rules are public before any money
is. Where the testnet and the real-money contract differ, both are stated. The contract has not been reviewed
by anyone outside the project; the limits below are what bound a fault in it.

## What this is

An **escrow with a named referee**. Two people who disagree about a prediction each put the same amount into a
contract. The referee — **Vaticeno, operated by n30sk** — records the verdict, and the contract pays the winner.

The code guarantees custody and payout: nobody, the referee included, can take staked money out any other way.
The code does **not** guarantee the verdict is right. That is the referee's job, and the void below is how a
mistake is undone. This is not trustless, and it is not impartially arbitrated by anyone but us.

## Which predictions

Only those decided by a price — for example "BTC above $150,000 by 2026-12-31", judged on the daily close
from the source the prediction names. Predictions judged by reading web pages can be recorded and judged as
usual, but cannot be staked on.

## Networks

Each network is its own market. An offer opened on Base is matched, settled and paid on Base; one on Arbitrum
One stays on Arbitrum One. A prediction can carry stakes on both, and the same verdict settles both. The wager
page shows one network at a time and says which.

## The timeline

| When | What happens |
|---|---|
| Opening | one person stakes on HIT or MISS |
| Up to 7 days, and no later than 24 hours before the deadline | someone else may take the other side with the same amount; otherwise the offer expires and its stake goes back to the opener |
| After the deadline | the referee records the verdict |
| **72 hours** after the verdict | the payout hold: the stake can only be voided, not paid |
| After the hold | **anyone** can trigger the payout |
| **14 days** after the deadline with no verdict | **anyone** can trigger a refund; both sides get their own stake back |

A VOID verdict — the prediction could not be decided — refunds both sides.

**How money comes back.** Straight to your wallet, with nothing to press: when the hold ends the referee pays
out the winner, at the timeout it refunds both sides, and an offer nobody took goes back to its maker. Anyone
else may make the same calls; the contract pays the right person whoever does. Only if USDC refuses to send to
an address (Circle has frozen it) does that person's money wait in the contract as a credit, which they take
with **Withdraw** once it is unfrozen; the other side is paid as usual.

## Limits

| | Testnet | Real money |
|---|---|---|
| Per side of a stake | 100 test tokens | **1,000 USDC** |
| Smallest stake | none | **0.01 USDC** |
| All stakes on one prediction | none | **10,000 USDC** |
| All stakes on one network | none | **50,000 USDC** |

The contract itself refuses a stake past any limit, and the wager page says which limit before your wallet
asks you to sign. The limits are fixed when the contract is deployed; raising one means a new contract and a
dated owner decision.

## Voids

During the 72-hour hold, and only then, the referee may void a stake. Both sides get their own stake back.
Nobody is paid, and nothing is charged.

A stake is voided only for a fault that can be checked independently:

| Code | Ground |
|---|---|
| 1 | the source value was read wrong |
| 2 | a defect in how the verdict was reached |
| 3 | the evidence does not satisfy the prediction as it was locked |

Every void is published with its code and a reference to the evidence.

**A complaint alone pauses nothing and refunds nothing.** Disagreeing with a correct verdict is not a ground.
There is no appeal and no challenge bond: the referee is the only referee, and that is a limit of this
product, stated rather than hidden.

**After the hold, a verdict is final on the chain.** If a mistake is found later, the published verdict is
corrected on the prediction's page, but money already paid stays paid. The 72 hours exist so a mistake is
found before that.

## Fees

None. The contract cannot be changed to charge more than 5%, and both the testnet and the planned real-money
contract are deployed with a fee of zero. A refund, a void or an expired offer never pays a fee, whatever the
fee is.

## Risks we cannot remove

Said plainly, because none of them is solved by the contract:

- **USDC can block an address.** Circle, which issues USDC, can freeze any address. If it freezes yours, you
  cannot withdraw your credit while the freeze lasts; the other side withdraws theirs as normal.
- **USDC can block the escrow, or pause.** If Circle freezes the escrow's own address, or pauses USDC
  transfers, **nobody can withdraw** until it lifts. The credits stay recorded in the contract.
- **A network can stop.** If Base or Arbitrum One halts, nothing moves on it until it restarts. Every deadline
  in the contract is measured in the network's own time.
- **The referee can be wrong.** The void covers mistakes found within 72 hours, not later ones.
- **The code can have a fault.** It is tested, but not reviewed by anyone outside the project. The limits above
  cap what any one fault can reach.

## The roles

| Role | Held by | Can | Cannot |
|---|---|---|---|
| **Referee (oracle)** | the server, one key per network | record a verdict; void a stake inside the hold | pay anyone, or move money anywhere but back to both sides |
| **Guardian** | the operator alone, a separate wallet kept offline | stop new stakes; void a wrong verdict inside the hold | pay anyone, take money, or block a payout, a refund, a withdrawal or an expired offer |
| **Anyone** | | pay out after the hold, refund after the timeout, return an expired offer | anything else |

Stopping new stakes never blocks anything that returns money.

## If something goes wrong

What the operator does, and how quickly. Each case is recorded as an incident (below).

| What happens | What we do |
|---|---|
| **A wrong verdict** is found inside the hold | the guardian voids the affected stakes with its code and evidence; the verdict is corrected on the prediction's page |
| **A source corrects its value** after the verdict | inside the hold: void with code 1. After it: the page is corrected and the correction published; payouts stand |
| **The referee's key may be stolen** | the guardian stops new stakes on that network at once, voids any verdict inside the hold that does not match the published one, and leaves every exit open. The key is never used again: a new contract with a new key replaces it, and the old one runs down through payouts, refunds and withdrawals |
| **A suspected fault or abuse** in the contract | the guardian stops new stakes on that network, every exit stays open; new stakes resume only once the cause is understood and written up |
| **Our server is down** | nothing is lost: stakes already settled pay out after the hold, unsettled ones refund at the 14-day timeout. Verdicts are written to the chain once the server is back, if the hold and the timeout still allow |
| **A network's node fails** | the worker retries on the next pass and tells the operator; the other network is unaffected |
| **The referee's gas runs low** | the operator is alerted before it runs out and tops it up |
| **A transaction is stuck or fails** | it is never shown as done; the worker retries and the operator is alerted if it does not clear |
| **A reorg** undoes a block | the worker reads each stake's state from the chain before sending, so nothing is settled twice |
| **USDC blocks an address or the escrow** | the affected credits wait; the incident is recorded and announced |

**How fast.** The guardian acts **within 24 hours** of an alert, so inside the 72-hour hold. The operator
brings the guardian's wallet online; nobody else holds it. If the operator cannot act at all, the contract
still pays out, refunds and returns expired offers on its own.

## How you are told

- On the **wager page**: a notice while new stakes are stopped, and each stake's state as the chain records it.
- On the **prediction's page**: any correction or void, with its reason.
- In the **thread on X** where the prediction was made: the verdict, once.

## Where incidents are recorded

Each incident gets a dated entry in `docs/incidents/` in this repository: what happened, what was done, which stakes it
touched, and what changed so it does not happen again. The record is public.
