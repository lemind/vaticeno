# Feature Specification: USDT on Tron

**Feature Branch**: `usdt-tron`

**Created**: 2026-11-21

**Status**: Draft

**Input**: Owner, 2026-11-21: "let's add USDT on Tron" — a real-money market in Tether's TRC-20 USDT beside the
USDC markets on Base and Arbitrum One and USDT0 on Arbitrum One. Decision record: `docs/decisions/010-usdt-tron.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stake USDT from a Tron wallet (Priority: P1)

Someone holds USDT on Tron. On a claim's wager page they pick Tron, connect TronLink, and open an offer or accept
one, in USDT, without bridging anything.

**Why this priority**: it is the feature: USDT held on Tron can be staked as it is.

**Independent Test**: on Nile, open an offer from one TronLink wallet and accept it from another; the stake shows on
the page under Tron, apart from the other networks.

**Acceptance Scenarios**:

1. **Given** a locked price claim inside its acceptance window, **When** a visitor picks Tron and connects TronLink,
   **Then** the page shows Tron's offers only, in USDT, with Tron addresses (`T…`) and Tronscan links.
2. **Given** an open Tron offer, **When** a second wallet accepts it, **Then** the stake is matched on Tron and a
   USDC or USDT0 offer on another network is never matched with it.
3. **Given** the visitor has no TronLink, **When** they pick Tron, **Then** the page says TronLink is needed, and
   nothing else changes.

### User Story 2 - Settled on Tron with the claim's verdict (Priority: P1)

The claim resolves. Every Tron stake is paid, refunded or voided on Tron, by the settlement worker, with the same
verdict as the claim's stakes on other networks, and nobody presses a button for their money.

**Independent Test**: on Nile, a HIT, a MISS and a VOID each move the test token straight to the right wallet; a
wallet the token blocks is credited instead and can withdraw once unblocked.

**Acceptance Scenarios**:

1. **Given** a matched Tron stake and a final verdict, **When** the hold ends, **Then** the worker pays the winner on
   Tron and the outbox records it per network.
2. **Given** Tron's node is unreachable, **When** the worker runs, **Then** it retries next run; nothing is voided
   and no other network waits for it (constitution III).
3. **Given** the token refuses a payment to one address, **When** the worker pays, **Then** that address is credited
   and the other side is paid.

### User Story 3 - The owner sees Tron in health and costs (Priority: P2)

The owner's status page shows Tron's escrow like each other network: what it holds, what it owes, the worker key's
TRX and energy, and alerts when they run low.

**Independent Test**: the status page lists Tron with its locked and credited totals read from the chain.

### Edge Cases

- The worker's key runs out of energy or TRX: settlement waits and the owner is alerted; a stake still refunds itself
  at the timeout (FR-036b).
- Tether freezes the escrow's own address or pauses the token: the risk stays documented, never presented as solved
  (FR-036e).
- A visitor's TronLink is on Nile while the page is on mainnet, or the other way: the page says so and sends nothing.
- A Tron offer and an EVM offer on the same claim: both stand, matched and settled each on its own network.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Tron mainnet is a real-money market in **Tether's USDT (TRC-20)** only, with its own escrow
  contract, oracle key, outbox rows and offers (003 FR-036d). No other Tron token is accepted.
- **FR-002**: The escrow on Tron is EscrowV2 with the numbers of 007-escrow-v2 (USDT base units, 6 decimals) and a
  fee of 0. Its constructor accepts only Tether's USDT on Tron mainnet, any token on Nile.
- **FR-003**: Nothing is deployed to Tron mainnet before the contract has run end to end on Nile — open, accept,
  HIT, MISS, VOID, the guardian's void, the timeout, an expired offer and a blocked address — and the incident
  policy covers Tron (006).
- **FR-004**: The facts ADR 010 lists (USDT's `transfer` return value, `block.chainid` and the signed domain,
  energy per transfer) are measured on Nile and written down before the contract is changed for them; each
  workaround is a tagged HACK.
- **FR-005**: The wager page offers Tron beside the other networks, through TronLink; it shows Tron addresses in
  their `T…` form and links to Tronscan, and refuses to send when TronLink is on a different Tron network.
- **FR-006**: The settlement worker settles Tron stakes in the same loop and outbox as the EVM ones; a Tron outage
  is retried and never delays or voids a stake on another network (constitution III).
- **FR-007**: Every transaction the worker sends on Tron records its cost in TRX and in dollars, as the EVM gas is
  recorded.
- **FR-008**: Fees are paid as on the other networks: each wallet pays for what it sends (003 FR-042), the worker
  pays for the verdict and every exit in TRX burned for energy (FR-036b). The status page shows Tron's locked and
  credited totals and the oracle's TRX, and alerts below a threshold (003 FR-022c).
- **FR-009**: The minimum and the caps are the other networks' (007): 0.01 USDT minimum, 1,000 per side, 10,000
  per claim, 50,000 per network.
- **FR-010**: **NEEDS DECISION** (owner): wallet linking for Tron addresses now or later (ADR 010). Until decided,
  Tron stakes are shown by address only.
- **FR-011**: The wager reply's money line names Tron and USDT when the claim's page offers it (003 FR-039).

### Key Entities

- **Network** (existing): gains a chain family, EVM or Tron, and Tron's address form and explorer.
- **Outbox row** (existing): its network key names Tron's market; nothing else changes.

## Success Criteria *(mandatory)*

- **SC-001**: On Nile, every path in FR-003 settles to the right wallet, with the same verdict as an EVM stake on
  the same claim.
- **SC-002**: The cost of one Tron settlement is measured and written into ADR 010, replacing UNRECONCILED.
- **SC-003**: After launch, a Tron stake is settled within the same hold and window as an EVM one.

## Assumptions

- TronLink is the only Tron wallet supported at first.
- The verdict, lock, caps, guardian and fee are unchanged (007-escrow-v2).
- No legal opinion or outside review is awaited (owner, 2026-10-29).
