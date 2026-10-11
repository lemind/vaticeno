# Private notes — money

**Private. This file and all of `docs/private/` are gitignored.** Nothing here is public, committed, or
referenced from `specs/`, `README.md` or commit messages. Last rewritten 2026-10-08.

Money only: where it could come from, what could be sold, and what would have to be registered if any of it
ever happens. Nothing here is decided and nothing here is next. Every figure is a ballpark to verify before
paying it. Not legal advice.

The technical plan moved out: operations, capacity and cost live in `specs/003-python-platform/`.

---

## 1. Money before there is an audience

No entity is needed for any of this. Burn today is roughly $20–40/month, so this list only has to cover a
droplet and some model calls.

| Route | Paperwork | Notes |
|---|---|---|
| **Crypto tip address** in the bio and on claim pages | an address | Fastest thing available, and it fits the audience. Fifteen minutes of work |
| **Ecosystem grants** — Base, Arbitrum, Optimism rounds, quadratic-funding rounds | a project page and a wallet; most pay individuals | **Best fit.** Non-dilutive, no company, and a public referee with an auditable record is the kind of thing these fund. A few thousand covers a year of infra |
| **Hackathons** | a submission | Highest leverage on the list: prize money to a wallet, plus judges, plus audience, plus a deadline that forces the work to finish |
| **GitHub Sponsors / Ko-fi / Buy Me a Coffee** | a personal account and a bank or PayPal | Works as an individual, no company. Slow at this audience size, but it is an afternoon's work and it signals the project is real |
| **Model and cloud credits** — startup programmes | a form | Not cash, but it deletes the largest variable cost outright |
| **Contract or employed work** | a CV | Unglamorous, and the most reliable funding this project will have for a while. It is also the reason the new service layer is Python |

Two cautions:

- **Do not pre-sell Pro, and do not promise features for donations.** That turns a gift into an obligation
  that has to be met even if the product never launches. Donations buy goodwill, not a roadmap.
- Money into a personal wallet or account is still taxable income where the recipient is tax resident,
  whatever the source. Keep a one-line ledger from the first payment; reconstructing it later is the
  expensive version.

---

## 2. What could be sold, later

**Not MVP.** Nothing here gets built until there is an audience. Written down so the options are not
re-argued from scratch.

### Free forever

Recording a claim, the verdict, the claim page. That is the funnel, and charging for it kills the product.

### Pro, around $5/month — in order of how much it is worth believing in

| Sell | Why someone pays |
|---|---|
| **Verified track record** — a profile with the record, calibration, streaks, and a shareable card image for X | The entire point of being on the record is showing it off. The natural upsell, and it needs no new primitives |
| **Sealed claims** — recorded and hashed now, hidden until the deadline, then revealed with proof it never changed | Nobody else can offer this. It is the lock primitive turned into a feature |
| **Head-to-head and private leagues** — a group of friends, a leaderboard, settled history. Billed per group, not per head | Social products convert at the group level, not the individual one |
| Alerts — when a claim resolves, when someone you follow records one | Retention more than revenue |
| Higher limits, deeper judging — more claims a day, a bigger evidence budget per claim | Maps onto the per-claim budget work already planned |
| Export — your record as CSV or JSON | Cheap to build, closes some sales |

### Bigger than the subscription

- **A discount instead of a subscription**, if there is ever a transaction fee to discount. Aligns two
  products instead of making them compete for the same $5.
- **The resolver as an API** — "here is a statement and a deadline, return a verdict with the evidence". The
  genuinely valuable asset, sellable without touching anyone's money, and the one thing here a business
  could actually be built on. If one line item wins, bet on this.

Left alone deliberately: sponsored or branded claims. The product is a referee nobody can accuse of
anything, and that is worth more than the ad.

### Expectation setting

Consumer bot subscriptions convert at maybe 1–2% of active users. At current scale $5/month funds the
droplet, not a company. Its real early value is proving that anyone will pay at all.

Note: payments are on the constitution's deliberately-absent list (VII). The first subscription is an
amendment, not just code.

---

## 3. If a cut is ever taken

Only the money rules here; the mechanics are in the other private file.

| Rule | Why it is not negotiable |
|---|---|
| The cut cannot depend on the outcome — identical rate whoever wins, **zero** when nobody wins | A referee who earns more from one answer is not a referee. This is the first thing any critic reaches for, and it is answerable in code rather than in a promise |
| The operator can never move user funds — **no withdrawal path at all** | "The operator holds the referee's key, never the money" is a sentence that can be put on the site, and it is worth more than the percentage |
| The rate is capped at a hardcoded maximum and cannot be raised quietly | Otherwise every user has to trust a future version of us |

What the cut actually costs: a free service between two people and a service that takes a percentage *and*
decides the result are different businesses to a regulator — see §4. That is the real price, not the
percentage.

---

## 4. Entity and jurisdiction, when it is time

Three different businesses, and taking a cut is what moves between them:

| | Activity | What it is |
|---|---|---|
| **A** | Record, judge, publish. No money handled | Software publisher — any cheap company anywhere |
| **B** | Funds held, settled by us, **a cut taken** | Operating a licensed activity in most places, arguably also handling customer funds |
| **C** | Funds held, settled by us, **no cut** | Much thinner. A normal company and careful wording |

**Keep A and B in separate entities.** The regulated activity contaminates the clean one — that is how
payment processors, banks and app stores end up refusing the whole thing rather than one product.

### Operating company (for A and for subscriptions)

| Option | Ballpark | Fit |
|---|---|---|
| **Estonia OÜ** via e-Residency | ~€500–600 setup, ~€300–500/yr accounting | Best all-rounder: 0% tax on retained profit, real SEPA banking, fully remote. Software and subscriptions — not B |
| **US LLC** (Wyoming/Delaware) | ~$150–400 setup, ~$100–400/yr | Cheapest route to Stripe. The worst possible flag for B |
| **UK Ltd** | ~£50 | Cheapest formally. For B, operating without the relevant licence where UK users can reach it is criminal, not a fine |

### The B entity, only if it ever happens

Offshore plus geoblocking is the realistic menu. Costa Rica (a data-processing company, no licence as such)
is cheapest at roughly $1–5k and cheap because it is thin — no banking, increasingly refused by partners.
Anjouan roughly $25–40k, Curaçao's current regime considerably more, Malta / Isle of Man / Gibraltar €100k+
and months. Crypto-native alternative: a Marshall Islands DAO LLC (~$1–2k) or a BVI / Panama / Cayman
foundation (~$2–15k) publishing an interface to a contract with no withdrawal path.

Two things that are easy to get wrong:

- The company's flag does not move personal tax. Revenue received at an address controlled by one person is
  taxable where that person lives, whatever the entity's letterhead says.
- Incorporating early buys nothing. What forces it is exactly four events: **taking a cut, holding other
  people's funds, an investor, or a co-founder.** Until one of those happens, the €600 is better spent on
  the droplet.

---

## 5. How raising works, for reference

Nobody invests in a project without a company. The sequence is traction → interest → incorporate → money on
a **SAFE** or a convertible note. A SAFE is neither a loan nor shares: it converts into equity at the next
priced round, usually with a valuation cap, no interest and no repayment date. Angel cheques run $10–100k,
pre-seed funds $250k–1M, for roughly 5–20% of the company. Accelerators bundle the same thing — a standard
deal is around $500k for 7% plus a follow-on instrument — and they help with incorporation, so applying
before having an entity is normal.

The part that matters: **investors buy traction, not ideas.** With no users, a raise either does not happen
or happens on terms that cost a fifth of the company for a year of droplet money. A grant and a hackathon
prize are the same cash and take nothing.

---

## 6. Open questions

| Question | Status |
|---|---|
| Tax residency and citizenship of the owner | needed before any jurisdiction can be recommended |
| Tip address and a sponsors page — now or later? | an hour of work, no paperwork; leaning now |
| Which grants to target | shortlist not made |
| First paid product: track record, sealed claims, leagues, or the API | open, and not soon |
| Whether a cut is ever taken at all | open; §3 holds regardless of the number |
| First entity, and when | nothing until one of the four triggers fires |
