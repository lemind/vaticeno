# Settlement policy

**Testnet only.** Stakes are a test token worth nothing. No real money is accepted.

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

## The timeline

| When | What happens |
|---|---|
| Opening | one person stakes on HIT or MISS |
| Up to 7 days, and no later than 24 hours before the deadline | someone else may take the other side with the same amount; otherwise the opener can take their stake back |
| After the deadline | the referee records the verdict |
| **72 hours** after the verdict | the settlement window: the stake can only be voided, not paid |
| After the window | **anyone** can trigger the payout; the winner receives both stakes |
| **14 days** after the deadline with no verdict | **anyone** can trigger a refund; both sides get their own stake back |

A VOID verdict — the prediction could not be decided — refunds both sides at once.

## Voids

During the 72-hour window, and only then, the referee may void a stake. Both sides get their own stake back.
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

## If something goes wrong on our side

- **We disappear**: after 14 days anyone can refund every stake that was never settled. Nothing waits on us.
- **Our verdict key is stolen**: a separate key, kept offline, can void wrong verdicts inside the window and
  stop new stakes. It can never pay anyone. Stakes are capped at 100 tokens a side, which bounds the damage.
- **Stopping new stakes** never blocks a payout, a void, a refund or an expired offer coming back.

## Fees

None. The contract cannot be changed to charge more than 5% — and on this deployment the fee is zero.
