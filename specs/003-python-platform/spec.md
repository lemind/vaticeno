# Feature Specification: Visibility, settlement and cost

**Feature Branch**: `003-planing`

**Created**: 2026-10-08

**Status**: Draft

**Input**: Owner: the service runs on a small VPS and there is no way to see whether it is healthy, what
broke, or where the project stands without reading logs. Nothing has ever been measured under load, so
every capacity and price number in the specs is a guess. Model calls are the largest variable cost and most
of them decide easy cases. Three pieces of work, one new runtime: a status page, a measured capacity
baseline, and a local verifier that keeps the paid model for the cases that need it. The new service layer
is written in Python, deliberately (owner decision 2026-10-08).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The status page (Priority: P1)

A page that answers two questions in one screen: **is it running**, and **where are we**. The owner opens it
after a deploy, during an incident, or when returning to the project after a week away, and does not read
logs to find out that the mentions job has been dead since Tuesday.

**Why this priority**: everything else in this feature produces numbers, and there is nowhere to put them.
It is also the only part that is useful on its own, the day it ships.

**Independent Test**: stop one job, or point the service at a dead database, and the page names what is
broken within one refresh — not "something is wrong", but which job, and how long it has been stale.

**Acceptance Scenarios**:

1. **Given** a healthy service, **When** the page is opened, **Then** it shows the build (commit, deploy
   time and how long ago that was, runtime version), each job's last run and outcome, claim and verdict
   counts, spend against the per-claim ceiling, and the feed's state — read from the database, the build-info file and the
   progress file, with nothing hardcoded in the page itself.
2. **Given** the resolve job has not run for longer than its declared stale-after window, **When** the page
   is opened, **Then** that job reads **STALE** with its age, and the page's overall state is not "ok".
   Every job declares its own window (its schedule plus a grace), because a job that runs every minute and
   one that runs twice a day are not late at the same point.
3. **Given** the database is unreachable, **When** the page is opened, **Then** it says so plainly and
   still renders, rather than returning a stack trace or a blank page.
4. **Given** a verdict needing human review, **When** the page is opened, **Then** the backlog is visible
   with its oldest item's age.
5. **Given** the owner has edited the progress file, **When** the page is opened, **Then** the current
   stage, what is done, what is in progress and what is next are shown, with the date that file last
   changed — so a stale plan is visibly stale rather than quietly wrong.
6. **Given** the page holds operational numbers, **When** it is deployed, **Then** it is not reachable from
   the public internet (the public server stays read-only claim and author pages, no admin routes).
7. **Given** no session, **When** the page or its JSON twin is requested, **Then** the page redirects to a
   login and the twin answers 401 — and with no password configured on the server, both refuse.
8. **Given** the public front page, **When** anyone opens it, **Then** it shows the system's state, the
   running version and the counts of predictions and verdicts, and nothing operational.
9. **Given** the weekly recheck found a published verdict that today's rules decide differently, **When** the
   page is opened, **Then** that verdict is listed with what was published, what the rules reach now, and how
   long it has been outstanding — and it stays listed after it ages out of the recheck's seven-day window,
   until a correction is posted or it is dismissed.

**Still to plan** (owner, 2026-10-13): the page should also answer "where does the book stand" — how many
claims exist, how many are settled against how many are still open, how many carry a recheck finding nobody
has cleared, and one line per running service rather than one per scheduled job. Left unplanned on purpose
until the first version of the page is on screen: the numbers are easy, the right grouping is the part worth
seeing before deciding.

---

### User Story 2 - A measured capacity baseline (Priority: P1)

Nothing in this system has been measured under load. The specs carry prices and limits labelled
UNRECONCILED, the droplet's real ceiling is unknown, and the first time anyone finds out what breaks will
otherwise be the day an invite goes out. This story replaces guesses with measurements, and records the
limits where they can be read later.

**Why this priority**: "measure before optimizing" is a project rule, and right now there is nothing to
optimize against. It also gates any public launch: the honest answer to "how many users can this take" is
currently unknown.

**Independent Test**: a load run against a local instance produces a capacity table — requests per second
at a stated latency, the point at which the database connection pool saturates, peak memory, and what the
service does past that point — and the same run can be repeated after a change to see whether it regressed.

**Acceptance Scenarios**:

1. **Given** the public pages, **When** load is raised until latency degrades, **Then** the request rate,
   the p95 latency and the failure mode at that point are recorded, and nothing crashes.
2. **Given** a burst of **synthetic** mentions far larger than the live rate (X is stubbed; this measures our
   side, not X's), **When** the jobs run, **Then** every mention is answered exactly once, no reply is
   duplicated, and the backlog drains — slower, not broken.
3. **Given** the database connection limit, **When** load exceeds what the pool can serve, **Then** the
   service queues or refuses cleanly and recovers, rather than exhausting connections and wedging.
4. **Given** the VPS's memory, **When** every process runs at once (the service with its jobs, the status
   service, and the verifier once it exists), **Then** peak memory is recorded against the box's size, with
   the headroom stated.
5. **Given** a measured number, **When** it is written down, **Then** the matching UNRECONCILED label in
   the other specs is replaced with the measurement and its date.

---

### User Story 3 - A local verifier before the paid model (Priority: P2)

Most resolutions are easy: the evidence plainly says the claim happened or plainly says it did not. Those
cases currently cost a paid model call each. A small local model reads the claim against each passed
evidence item and answers one narrow question — **does this evidence clearly entail the claim, clearly
contradict it, or neither** — and only the "neither" cases, and anything short of near-certainty, go to the
paid model.

The local model's job is to **prove a case is easy**, never to be clever. It adds no evidence, and it can
only ever agree with evidence that has already passed the existing code gates.

**Why this priority**: it is the one change that lowers the per-claim cost rather than capping it, and it is
useless before there is a way to measure its mistakes — which Story 1 and the existing cost records provide.

**Independent Test**: on a held-out set of real claims with known verdicts, the fast path auto-finalises
**zero** of them wrongly, and the share of resolutions that avoided a paid call is reported.

**Acceptance Scenarios**:

1. **Given** evidence that has passed the code gates and clearly entails the claim, **When** confidence is
   above the threshold and two items that the existing independence gate treats as independent agree,
   **Then** the verdict is final without a paid call, and the record says the local verifier decided it.
2. **Given** evidence that is ambiguous, partial, or disagrees with another item, **When** the verifier
   runs, **Then** it escalates to the paid model and makes no decision of its own.
3. **Given** no evidence at all, **When** the verifier runs, **Then** the outcome is VOID exactly as today —
   the verifier never turns absence into a MISS.
4. **Given** a numeric, date or entity mismatch between claim and evidence, **When** the verifier is
   confident anyway, **Then** the case is escalated regardless of confidence.
5. **Given** the local model is missing, broken or slow, **When** a resolution runs, **Then** everything
   falls through to the paid model and nothing fails.
6. **Given** a resolution decided on the fast path, **When** it is reviewed later, **Then** the claim,
   the evidence, the confidence and the model version are all recoverable from the record.
7. **Given** shadow mode, **When** a resolution runs, **Then** the paid model decides as it does today and
   the local model's answer is recorded **separately**, alongside what the paid model concluded — the
   resolution record still names the paid model as the decider, because it was.

---

### User Story 4 - Settlement on a testnet (Priority: P3)

Two people who disagree about a recorded claim each put up the same amount on a testnet. The claim's existing
verdict decides who gets it, and the payout is carried out by a worker that reads the verdict already written
in the database. No real money, and nothing about how a claim is recorded or judged changes.

**Why this priority**: last because everything before it is useful without it, and worth doing because it is
the only part that turns the referee into something enforceable. Testnet is the whole scope: the proof is that
a verdict can settle a contract, not that anyone should stake on it.

**Independent test**: two addresses stake equally on a recorded claim, the deadline passes, the resolver writes
its verdict as it does today, and the winner's balance changes without anyone touching a wallet. Then the same
with VOID, and the same with the worker switched off for the whole timeout window.

**Acceptance Scenarios**:

1. **Given** a recorded claim, **When** one party opens a stake and another accepts with an equal amount,
   **Then** the contract holds both and neither party can withdraw unilaterally.
2. **Given** a final verdict, **When** the worker runs, **Then** the winner is paid once and the transaction
   reference is recorded against the claim.
3. **Given** VOID, **When** the worker runs, **Then** both parties are refunded in full and nothing is taken.
4. **Given** a stake already settled, **When** the worker runs again, **Then** nothing is sent — it reads the
   contract's state first, and the contract rejects a second settlement.
5. **Given** the deadline passed longer ago than the timeout and nothing was settled, **When** either party
   asks for a refund, **Then** both are refunded without the operator being involved at all.
6. **Given** the operator's key, **When** any attempt is made to move staked funds other than settling a final
   verdict or refunding, **Then** no function exists that permits it.
7. **Given** a claim with no stake on it, **When** its verdict is written, **Then** nothing on-chain happens.
8. **Given** a verdict the local verifier decided alone, **When** a stake exists, **Then** it is not settled on
   that verdict.
9. **Given** someone who wants their stake attributed to them, **When** they name their X account on the link
   page, post `@vaticeno link <code>` from it, confirm the account the page shows, and sign with the wallet,
   **Then** the link is written — and not before the page has said that the link is public and permanent.
10. **Given** a code copied from a public post and returned by a different account, **When** the bot reads
    it, **Then** nothing binds and nothing is consumed: the code stays good for the account it was issued
    to until it expires, and the attempt is recorded.
11. **Given** nobody has linked a wallet, **When** a stake is opened and settled, **Then** everything works:
    linking is never required to take a side.
12. **Given** a claim the model judged rather than the price feed, **When** a stake is attempted on it,
    **Then** it is refused before anything is written.
13. **Given** a final verdict on a staked claim, **When** the payout is attempted before the settlement
    time, **Then** the contract refuses; after it, any address at all can trigger it.
14. **Given** the window is still open and the operator can show the verdict read the wrong value, **When**
    the void is called, **Then** both parties get their own stake back and nothing reaches either side or
    the operator.
15. **Given** the window has closed, **When** the void is called, **Then** it is refused — finality is a
    time, not an opinion.
16. **Given** a stake nobody accepted, **When** its offer expires, **Then** the maker recovers the full
    amount without the operator.

---

### User Story 5 - The wager page (Priority: P3)

Someone reads a recorded price claim on X and wants to back one side of it. They reply `@vaticeno wager`,
the bot answers once with a link, and the page lets them connect their own wallet, make an offer or take one,
and later collect what they won or the refund they are owed. This is the human front of Story 4: the contract
and the worker already exist, and without this page a stake can only be made from the command line (owner
decision 2026-10-19, after the testnet run passed).

**Why this priority**: Story 4 proved a verdict can settle a contract, but nobody outside the operator can
use it. This is the smallest page that lets two people who disagree actually put the claim to the test.

**Independent test**: on a throwaway testnet deployment whose hold and timeout are minutes, as in T337, two
browsers with two wallets, and four separate wagers, one per ending, because a wager has one ending only: (a)
`wager` gets the link, one wallet opens on HIT, the other accepts on MISS, payout is refused during the hold
and pressed by a third address after it; (b) a VOID refunds both at once; (c) an offer nobody took is
returned after expiry; (d) with the worker stopped, a matched wager is refunded from the page at the timeout.

**Acceptance Scenarios**:

1. **Given** a locked price claim inside its acceptance window, **When** anyone posts `@vaticeno wager` as a
   reply to the bot's reply in the claim's thread, **Then** the bot replies once in
   that thread with the claim's wager link and the no-value line, and later `wager` posts for the same claim
   get no reply.
2. **Given** a price claim that is not locked yet, **When** `wager` arrives, **Then** one short reply without
   a link says when wagering opens, and the claim's one link reply is still unused.
3. **Given** a model-judged claim, or one whose acceptance window has closed or never existed, **When**
   `wager` arrives, **Then** one short reply without a link says why, once per claim and reason.
4. **Given** a `wager` post whose direct parent is none of those, **When** the bot reads it, **Then** nothing
   is posted and nothing is recorded as a claim.
5. **Given** the wager page, **When** it opens, **Then** it shows the locked contract and its resolution rule,
   the deadline, when wagering closes, when an unmatched offer expires, the open and matched wagers read from
   the chain, the payout rule (twice the stake, minus the fee if one is set), and the no-value line —
   before any wallet is connected.
6. **Given** a connected wallet on the wrong network, **When** the person tries to act, **Then** the page asks
   to switch and does nothing until it has.
7. **Given** a maker who picks a side and an amount within the maximum, **When** they confirm, **Then** the page
   asks for the token approval if the allowance is short, then the open, shows each transaction as pending
   until it is mined, and lists the offer only once the chain shows it.
8. **Given** an open offer, **When** a second wallet takes it, **Then** the page asks for the approval if needed,
   then the accept, and the wager shows as matched only once the chain says so. The maker cannot take their
   own offer.
9. **Given** a verdict posted on X but not yet written on-chain, **When** the page opens, **Then** it shows the
   verdict and says settlement is pending; it never says paid before the chain does.
10. **Given** a HIT or MISS inside the hold, **When** the page opens, **Then** Pay out is shown disabled with
    its countdown; after the hold, any wallet can press it.
11. **Given** an unmatched offer past its expiry, a matched wager with no settlement on the chain by the
    timeout, or a VOID, **When** the page opens, **Then** it offers "Return expired offer" (to anyone; the money
    goes to the maker) or Refund where the contract allows it, and shows a VOID refund as already done. A
    verdict posted on X does not stop the timeout refund if it never reached the chain, and the page says so.
12. **Given** the guardian has paused new stakes, **When** the page opens, **Then** it says new offers and
    accepts are stopped and every way out still works.
13. **Given** a wallet with no active link, **When** its wager is shown, **Then** it is shown by address; a
    handle appears only for a link that was active when that address took its side (FR-035e).

### Edge Cases

- **A disagreement that ages out**: the weekly recheck re-decides only the last seven days. With no durable
  record, a verdict flagged one Monday is silently unflagged the next. Three were flagged on 2026-10-13: one
  was corrected, and the other two leave the window on 2026-10-19 with nothing left pointing at them.
- **Process uptime is not available to this page**: FR-003 allows it a database connection and two files,
  and nothing else, so it cannot ask systemd how long the bot has been up. It shows how long ago the deploy
  was, and the job table is what says the service is alive now (narrowed while building, 2026-10-13).
- **The status page's own health**: if the status service is down, nothing says so. It reports the main
  service's state, not its own; the main service's existing health endpoint stays the machine-readable
  truth, and uptime checking is outside this feature.
- **A load run against production**: never. Load tests run against a local instance or a disposable copy;
  pointing them at the live bot would post to X and spend real money.
- **A load run that spends money**: the harness must not reach X, the paid model or the price feed. Any
  external call in a load run is a bug in the harness.
- **The progress file is wrong**: it is hand-edited and will rot. The page shows its age; it never claims
  freshness it does not have.
- **A verifier upgrade changes past answers**: the model version is recorded per resolution, so a change is
  visible rather than silently rewriting history. Locked verdicts never change (constitution I).
- **The verifier is confidently wrong**: this is the failure that matters. The threshold is tuned for zero
  wrong verdicts on the held-out set, not for the highest savings, and a single wrong auto-verdict in
  production is grounds for turning the fast path off.
- **Two runtimes drift**: the two sides integrate only through a database table, or — for the verifier
  alone — one bounded call on localhost whose every failure means "no answer". No shared files, no shared
  memory, no imported code, and nothing from Python upstream of a verdict.
- **The settlement worker dies for good**: the timeout refund is the answer and it needs nobody from our side.
  Without it, a dead worker would mean funds locked forever — it is the single most important behaviour in
  Story 4.
- **A source outage delays a verdict past the timeout**: the refund path opens and both parties are made
  whole. An outage is never a verdict (INIT_SPEC §6.7), so it must never become a payout either.
- **The signing key leaks**: the worst case is wrong settlements, not stolen stakes, because the contract has
  no withdrawal path. That is the property the design exists to guarantee.
- **Gas runs out**: settlement stalls, the timeout eventually refunds everyone, and the status page shows the
  stalled queue.
- **Many offers on one claim**: the open authorization is one public signature per claim, and any holder can
  open any number of offers with it (FR-031a). The contract has no limit on their count, so the page cannot
  impose one either; it lists the newest first and caps how many it shows. A spammer spends their own tokens
  and gas.
- **A `wager` storm**: every URL-bearing post costs far more than a plain one, so one link reply per claim
  and a daily cap bound the spend; a request that is refused costs a plain reply at most once per claim and
  reason.
- **A wager mistaken for the author's bet**: anyone can make an offer on anyone's claim, against the author
  too. The page says so above the offers, and never states what the author did or did not wager.
- **The page and the chain disagree**: a wallet returning control is not a mined transaction, and an RPC can
  lag. The page shows what the chain says, the transaction hash while pending, and a failure plainly; it
  never infers success from a click. If the chain cannot be read at all, the page says so, never "no offers".
- **The link arrives before the signature**: the worker signs a claim's authorization a minute or so after
  lock. A link sent in that gap still works: the page says wagering opens shortly and shows the controls once
  the signature is there.
- **A short claim**: one whose deadline falls less than 24 hours after its lock can never be wagered, because
  acceptance has already closed (002-escrow-v1). It gets no link.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every scheduled job records its state in the database — which job, start, finish, outcome, and
  the error tag when it failed. Today the only job health that exists anywhere is the resolver's last run
  time, held in a variable inside the Node process where no other process can read it; the other seven
  scheduled jobs record nothing. Without this the status page can report that the database is up and
  nothing more. Each job also declares how long it may go without running before it counts as late, so
  lateness is a property of the job rather than a guess made while rendering.
- **FR-002**: The deploy writes a build-info file (commit, deploy time, runtime version) that the status
  page reads. No build information is inferred at runtime.
- **FR-003**: The status page is read-only and holds no credentials beyond a database connection, which is
  a **read-only database role**. It performs no writes, calls no external service, and has no admin action
  of any kind.
- **FR-004**: The status page is served at `/status` on the public host and is **never reachable without a
  password** (owner decision 2026-10-13, replacing "not publicly reachable at all"). It binds to localhost
  and is reached only through the reverse proxy or an SSH tunnel; the machine-readable twin is behind the
  same lock, because it carries the same numbers. A server with no password configured refuses everyone
  rather than admitting everyone — a missing credential is never an open door.
- **FR-004a**: One password, no accounts: no registration, no reset, no user records, and nothing behind it
  can be written. This is judged not to be the "user auth" constitution VII holds back (there is nothing to
  log into but this page); if that reading is rejected, it needs an amendment, not a workaround.
- **FR-004b**: The public front page at `/` shows whether the system is working, the running version, and
  how many predictions and verdicts exist — and nothing operational. Spend, job names, staleness and the
  verdicts known to be wrong stay behind the password. A job that has never run since a deploy does not
  make the public light red; a job past its own window, or one whose last run failed, does.
- **FR-004c**: One version number, in `package.json`, is the single source. Its minor bumps when a spec
  ships, so it never goes backwards the way numbering by spec number would; the deploy writes it into the
  build file, and both pages show the same value.
- **FR-005**: The status page renders server-side with no client-side JavaScript, matching the existing
  public pages, and renders a usable page when the database is down.
- **FR-006**: A machine-readable twin of the status page exists (one JSON response with the same numbers),
  so a future uptime check or a script needs no HTML parsing.
- **FR-007**: The progress block is read from one file the owner edits by hand; the page shows that file's
  last-changed date. The service never writes it.
- **FR-007a**: A verdict the weekly recheck decides differently is recorded where the status page can read
  it, and stays listed until a correction is posted or it is dismissed. The log line is not the record: the
  recheck looks at the last seven days only, so a disagreement found once otherwise disappears when the
  verdict ages out, and nothing is left saying a published verdict is known to be wrong.
- **FR-008**: A load harness drives the public pages and the job path, with every external dependency (X,
  the paid model, the price feed) stubbed. It cannot be pointed at production by accident.
- **FR-009**: Load runs produce a written capacity table: request rate at a stated p95 latency, the
  database connection ceiling, peak memory per process, and the observed behaviour past each limit. Each row
  carries the date it was measured and the hardware it was measured on.
- **FR-010**: Under overload the service degrades rather than failing unsafely: no duplicate replies, no
  duplicate posts, no lost mentions, and no verdict written twice. The existing lease and
  reservation rules are what the load runs are testing.
- **FR-011**: Numbers measured by this feature replace the matching UNRECONCILED labels in the other specs,
  with the measurement date (project rule: a documented number is not a verified one).
- **FR-012**: The local verifier runs only on evidence that has already passed the existing code gates. It
  produces no evidence, reads no sources, and cannot change what evidence says.
- **FR-012a**: The verifier is reached by one call on localhost with a hard timeout, and it holds no
  database connection. A timeout, a refusal, a malformed answer or nothing listening all mean the same
  thing — no opinion — and the resolution continues on the paid path. The call is an optimisation, never a
  step the pipeline depends on.
- **FR-013**: The fast path may finalise a verdict only when all of these hold: confidence above the
  threshold, at least two passed evidence items agreeing that the **existing independence gate** counts as
  independent (001's definition is reused, not redefined — two excerpts from one page are one item), every
  existing deterministic check passing, and no numeric, date or entity conflict between claim and evidence.
  Anything else escalates to the paid model. One resolution per claim stays the rule (constitution II).
- **FR-014**: Absence of evidence is VOID, never MISS, on the fast path exactly as on the slow one
  (constitution II; a source outage is still never a verdict, INIT_SPEC §6.7).
- **FR-015**: Every resolution records **who actually decided it**, and when the fast path decided, which
  verifier and version confirmed it. A verdict the paid model decided says so, even when the local model also
  had an opinion.
- **FR-016**: The local model's answers in shadow mode are recorded **apart from** the resolution record,
  with what the paid model concluded for the same case. Shadow answers decide nothing and must never be
  readable as the decision that was taken.
- **FR-017**: The fast path is behind a switch, off by default, and turning it off returns the system to
  today's behaviour without a deploy.
- **FR-018**: Fast-path volume is visible: how many resolutions took it, how many escalated, and the
  agreement rate against the paid model in shadow. A fast-path resolution can be **marked as contradicted**
  during the existing human review, and that count is shown — this feature adds the mark and the counter,
  not a new review process.
- **FR-019**: Two candidates are evaluated against each other on the same held-out set: an off-the-shelf
  entailment model with a threshold, and a small encoder fine-tuned on public fact-verification data. Both
  are deliverables — the comparison is the point, and the baseline winning is a valid result worth having
  measured. Selection is by precision, coverage at zero wrong auto-finalisations, inference latency and
  memory, in that order. No live traffic is used to train or evaluate, and no post text is stored to do it
  (INIT_SPEC §6.9).
- **FR-020**: The new service layer is Python, deployed as its own process with its own dependencies, and
  shares nothing with the Node service but the database. A second runtime is a departure from
  constitution VII ("Boring by Design", microservices deliberately absent) and needs an owner decision
  recorded alongside the amendment, as the own-feed work did for VI.
- **FR-020a**: Every process whose silence matters reports that it is alive, not only what it did: the
  settlement worker writes a heartbeat even with an empty queue, and a verifier call that timed out or came
  back malformed is recorded as a failed call rather than as no call at all. Each of the three roles that
  reach the database has only the rights its job needs; "the owner role, this table only" is not a
  restriction, because the owner bypasses row-level security (review 2026-10-12).
- **FR-021**: The Python side has its own tests, run in CI alongside the existing suite. The verifier's
  gate is exhaustively tested, like the other gates and the resolver; the status page is not (project rule:
  ~55% coverage is a cap, not a floor).

- **FR-022**: Stage 2 is **testnet only** — no mainnet deployment, no real value and no fee, until the
  contract has been reviewed by someone outside the project. A per-stake maximum is enforced in the contract
  from the first deployment regardless.
- **FR-023**: One escrow contract holds all stakes as a mapping, not one contract per stake. It stores the
  claim's identifier, the two addresses, the amount, the deadline and the state — and **no text**, the same
  rule the rest of the system follows (INIT_SPEC §6.9).
- **FR-024**: Both sides stake the same amount on a binary outcome. No odds, no partial fills, no pricing —
  that is what keeps the contract small enough to reason about.
- **FR-025**: Only the oracle address may settle, and only according to a verdict already final in the
  database. The contract has **no function that lets the operator move staked funds**, and none can be added
  without a new deployment.
- **FR-026**: Settlement is idempotent at two levels: the worker reads on-chain state before sending, and the
  contract rejects a second settlement of the same stake.
- **FR-027**: The Node service writes one outbox row when a price-feed claim locks and sets its outcome once the
  verdict is final and a second read of the price agrees; a disagreement holds the row, so nothing settles
  and the timeout refunds. It makes no chain calls. The worker signs the claim's open authorization from that row,
  and after the verdict settles every matched stake the contract holds for the claim, or records that there
  was none. That table is the entire interface between the two runtimes.
- **FR-028**: The settlement worker is a separate process holding the signing key, and does nothing else — no
  HTTP, no X, no model calls, no untrusted input. The key never exists in the process that handles text from
  strangers.
- **FR-028a**: A row in a table is not an instruction. The key is readable by the worker's own system user
  alone; the worker **builds the transaction itself** from the claim and its final resolution, read from
  their own tables, rather than signing any payload it is handed, and stops if the row's outcome disagrees; and before signing it checks the stake's on-chain state, the destination, the
  amount, the chain id, the contract address and that the stake is not already settled, stopping and
  reporting on any mismatch. Whoever can write an outbox row still cannot make it sign something the
  contract and the verdict do not already imply.
- **FR-029**: Every settlement attempt is recorded — stake, verdict, transaction reference, outcome, failure
  reason — and the status page shows the queue's pending, sent and failed counts plus the contract address.
  The on-chain events are the per-stake record; the outbox keeps one transaction reference per stake.
- **FR-030**: If a stake is unsettled longer than the timeout after its deadline, **anyone** may trigger the
  refund and both parties are made whole. This path does not depend on the operator being alive.
- **FR-031**: A verdict decided by the local verifier alone never settles a stake. Anything with value
  attached is decided by the price feed (FR-031a) or a human.
- **FR-031a**: Only a claim whose resolution method is the price feed may carry a stake (owner decision
  2026-10-09). Eligibility is decided off-chain, where the locked contract can be read, and proved on-chain:
  a stake cannot be opened without an authorization signed by the oracle for that claim hash. A hash alone
  tells the contract nothing about the claim, so without that signature the rule would hold only for stakes
  opened through our own page (review 2026-10-12). The worker signs it once per claim, from the locked claim
  alone, and it holds until acceptance closes; every stake on that claim uses the same signature. A price claim is decided by one number from the source the locked contract names, so a
  dispute is "was the right number read", answerable from the stored evidence in a minute. A model-judged
  claim is an argument about which source counts and what the evidence means, and that argument is not one
  to have with someone's money on it. Model-judged claims stay free to record and judge, as today.
- **FR-031b**: A stake is never paid out at the moment the verdict is written. Recording the verdict and
  paying are separate transitions: the first stores a settlement time and pays nobody, and after that time
  the payout is callable by **anyone**, so finality does not depend on the operator being online. A fee is
  fixed at deployment and set to zero on the testnet, so charging one later is a new deployment and a new
  decision, not a setting; no refund path — a VOID verdict, the operator's void or the timeout — ever
  charges one. The window is a fixed number of
  hours in the contract, not a policy anyone can change per stake.
- **FR-031c**: During that window, and only then, the oracle address — or the guardian, a separate key held
  offline for the case where the oracle's is compromised — may **void** a stake: both parties
  are refunded their own stake and nothing else happens. The function cannot pay either side, cannot pay
  the operator and cannot take a fee — those paths do not exist in it. Its purpose is to bound the cost of
  our own mistake to zero rather than to pay the wrong person.
- **FR-031d**: Void and the timeout refund are separate transitions with separate conditions. A void says a
  verdict should not stand; a timeout refund says no verdict arrived. Neither is reachable from the other's
  state.
- **FR-031e**: A complaint alone pauses nothing and refunds nothing. A stake is voided only for a material,
  independently checkable fault — a demonstrably wrong source value, a resolver defect, or evidence that
  does not satisfy the locked contract — and every void is published with a reason code and a reference to
  the evidence. Disagreeing with a correct verdict is not a ground. There is no challenge bond and no
  appeal body: the operator is the only referee, which is a limit of the product, stated rather than
  dressed up.
- **FR-031f**: The contract settles what cannot be added later. All of these exist in version one or not at
  all: one terminal state per stake and no double settlement; permissionless payout after the window; the
  void path; the timeout refund; expiry of a stake nobody matched, returning the maker's money; a maximum
  stake per wager; a fee ceiling and a fixed fee recipient with no arbitrary withdrawal; what happens if
  the oracle key is lost or compromised; whether new stakes can be stopped without blocking refunds owed;
  and events carrying the verdict and reason references, so a case can be audited from the chain alone.
- **FR-031g**: The product is described as an escrow with a named referee and a published settlement policy
  — never as trustless or impartially arbitrated. Custody and payout mechanics are guaranteed by the code;
  correctness of the verdict is not, and the void power is the proof that it is not.
- **FR-031h**: Real value is a separate decision from this feature, gated on three things: a legal opinion
  for the country the operator actually lives in, covering the betting-intermediary role and the event types
  offered; an independent reading of the contract and its state machine; and a written policy for oracle
  compromise, source corrections, voids and refunds. ESMA's statement of 3 July 2026 holds that event
  contracts qualifying as financial instruments fall under the permanent national binary-options bans, and
  that renaming the product does not avoid them; what is not a financial instrument can still be gambling
  under national law or fall under MiCA. None of that is answered by deploying to an L2 or by having no
  admin withdrawal.

- **FR-032**: Wallet linking is **optional**. Opening, accepting, settling and refunding a stake all work
  with no link, because the contract knows only addresses. Linking exists to attribute a stake to the author
  of a claim, and nothing else depends on it.
- **FR-033**: A link proves both halves. **The site issues the code**, after the person names their X account
  and the page resolves it to its numeric id; the account is proved when a post carrying that code arrives
  through the API from that id. The wallet is proved by an EIP-4361 signature whose message names the domain,
  URI, nonce, chain id, expiry, address and the numeric X user id, every field checked; ERC-1271 contract
  wallets are verified through the configured chain's RPC, and an RPC failure refuses, never accepts, leaving
  the challenge retryable until it expires. Undeployed smart accounts (EIP-6492) are out. A signature alone
  proves nothing about the account, and an account alone proves nothing about the wallet.
- **FR-034**: The signature is submitted privately, never in a public post, because a public one ties a handle
  to an address permanently. The post that proves the account carries only `@vaticeno link <code>`, and the
  bot's one reply in that thread names no address. Before issuing a code the page says what is public: the
  code post and the reply. Session tokens MUST NOT travel in a URL that appears in a public post.
- **FR-035**: The code is public, so it is bound to the expected account from the start: a post from any other
  author binds nothing and consumes nothing — otherwise anyone who sees a code can spend it and lock its owner
  out. The page still shows which account the code bound and asks for confirmation before the signature.
- **FR-035a**: `link` and `unlink` are commands, recognised before any claim parsing, so a code never becomes a
  claim or a NEEDS INFO reply. Each mention gets its one reply in its own thread and counts against the
  existing reply caps; a capped reply is withheld, but the binding still happens — the reply only tells.
- **FR-035b**: A challenge moves `issued → bound → completed`, each step a conditional update, so a code read
  twice or by two polls at once binds once. The code is about ten characters of a random alphabet, stored only
  as a hash; a post created outside the challenge's window is ignored; challenges per session and per IP address
  are capped. The TTL is a number measured against poll and API lag — **UNRECONCILED** until then.
- **FR-035c**: Linking is public attribution, and that is its only use (FR-032). One confirmation, before the
  signature, says the link shows the account beside the address and ties it to the address's on-chain
  history for good; there is no private link.
- **FR-035d**: Either half can revoke: the account by posting `@vaticeno unlink`, which ends all its links, or
  the wallet by signing. Revoking ends the public attribution; the row keeps its validity period.
- **FR-035e**: Each side of a stake is attributed only by a link that was active when that address took its
  side on-chain — the opener at open, the other at accept. A link made later attributes nothing earlier.
- **FR-035f**: An address with an active link refuses a second one with a message that names no other account;
  the holder revokes first.
- **FR-035g**: **NEEDS DECISION** (owner): what an X compliance event does to a link. Proposed: account
  deletion revokes it, and suspension hides it while suspended — both reversible on X, so neither erases it.
- **FR-035h**: No code and no post text reaches a log, an error report or a fixture: the code is read from the
  post in memory, hashed, and dropped (INIT_SPEC §6.9).
- **FR-036**: One network and one stake token for the whole feature. A second chain family is a second
  verification path, a second toolchain and a second settlement worker — not a configuration value.
- **FR-036a**: The network for real value — Arbitrum One or Base, both Ethereum layer 2s with native USDC on
  which the contract runs unchanged — is part of the real-value decision (FR-031h), outside this feature and
  blocking nothing in it. Whichever is chosen, its own testnet gets a redeploy and the end-to-end runs again
  before any real value, so what is tested is what ships. This feature stays on Base Sepolia, where the
  contract is live (002-escrow-v1).

- **FR-037**: `wager` is a command, recognised before any claim parsing like `link` and `unlink` (FR-035a),
  from anyone in the thread of a recorded claim — not only its author, because the contract lets anyone
  holding the authorization open a stake. The claim is found the way the bot already finds one: the post's
  direct parent is the claim's post, its summon, a fix or a bot reply in it. Never the conversation root,
  which can be an older, unrelated post, and never the post's text. Any other `wager` post gets no reply.
  The existing addressing rule still holds: once the bot is in a thread, a handle at the start of a reply
  may be one X carried, so a stranger is heard when they reply **to the bot's own reply**, and the author
  also under their own post (found while building, 2026-10-20).
- **FR-038**: A claim gets **at most one reply carrying its wager link**, to the first `wager` that arrives
  while the claim is locked, price-feed and inside its acceptance window. Later `wager` posts for that claim
  get no reply. A refusal — not locked yet, not a price claim, wagering closed — is one short reply with no
  link, at most once per claim and reason, and a refusal before lock does not use up the link. Reasons are
  checked in one order: not a price claim, then not locked, then closed (acceptance over, deadline passed, or
  a verdict in), so a claim that can never be wagered is never told it will open. A pause is shown on the
  page and is never a refusal. That the link was used is recorded before the reply is sent, and the reply goes
  out the way every reply does: the mention is marked answered before the post, and a failed post is never
  retried (INIT_SPEC §6.7). So a claim gets its link at most once, and a crash mid-post loses that link rather
  than risk a second one. Each reply is the
  one reply for that mention, counts against the existing caps (constitution IV), and goes only into the
  thread where the bot was tagged. Link replies also have a daily cap of their own, per UTC day, because a
  URL-bearing post is priced well above a plain one; its number is set later, and the price is
  **UNRECONCILED** until measured on a real reply.
- **FR-039**: The wager reply carries exactly one link, to our own domain, written as plain text, plus the
  line that the testnet token has no value. No other reply carries a link (constitution VI).
- **FR-040**: Claim pages move to `/claim/<slug>`, with the wager page at `/claim/<slug>/wager`. The old
  `/c/<slug>` redirects there permanently, because links to it are already published. The slug is the
  lookup key; the on-chain claim hash comes from the outbox row, never computed in the browser.
- **FR-041**: The wager page shows, before any wallet connects: the locked contract and its resolution rule,
  the deadline, when wagering closes, the offer-expiry rule, the payout (twice the stake, minus the fee set at
  deployment — zero on the testnet), the maximum stake, the newest 20 wagers on the claim as the chain
  reports them with how many there are in all, and that anyone can make an offer, so a wager is not the
  author's unless a link says so. No post text (V). Every field is escaped in the HTML, and the script
  receives data only as JSON, never as text spliced into code.
- **FR-042**: Everything that moves money is done by the person's own wallet, which signs and pays the gas;
  the page holds no key, sends nothing on anyone's behalf and has no faucet (owner decision 2026-10-19). Only
  the verdict is written by us, through the worker, at our cost. On the testnet, test tokens reach testers by
  the operator's script, the one the end-to-end run mints with, not through the page.
- **FR-043**: The page offers each action only in the state the contract allows it: open while not paused and
  before acceptance closes; accept while not paused and before the offer's own expiry, which is at the latest
  when acceptance closes; each preceded by a token approval when the allowance is short; return an expired
  offer, by anyone, to its maker; pay out after the hold, shown disabled with its countdown during it; refund
  after the timeout. Void is never
  a button: it belongs to the oracle and the guardian. Amounts are whole token units in the token's own
  decimals, never floating point. Every action shows its transaction as pending, mined or failed, and the
  page's state is what the chain says, re-read after each transaction — never what a click implies.
- **FR-044**: The page separates the verdict from settlement: the verdict as decided, then whether it is on
  the chain, then the hold's countdown, then paid or refunded. The hold is named as a payout hold during
  which the referee can void its own mistake (FR-031c, FR-031e) — not as a dispute anyone can open — and the
  page links the settlement policy.
- **FR-045**: The wager page and the link page are the only pages with a script: one small vanilla script,
  shared, that talks to the wallet the browser already has. No framework (constitution VII) and no new
  dependency without approval; every other page stays server-rendered without one. The page works read-only
  with no wallet at all.
- **FR-046**: The open authorization is public by design and served read-only, for a claim that has one and
  only until acceptance closes, with caching off so no copy outlives that. Nothing else from the outbox is
  served. The contract enforces the expiry itself either way.

### Key Entities

- **Job state**: which job, when it last started, finished and last succeeded, the last outcome (`ok` or
  `failed`) and error tag, when a run was last skipped because another held the lock — which is not an
  outcome, since the holder is usually working normally — how many times in a row it has failed, and how
  long it may go without running before it is late.
- **Build info**: commit, deploy time, runtime version. Written at deploy, read at render.
- **Progress note**: stage, done, in progress, next — one hand-edited file, with its modification time.
- **Capacity measurement**: what was measured, the number, the hardware, the date.
- **Verifier decision**: claim, evidence item, entailment outcome, confidence, model version, whether it
  finalised, escalated, or only observed (shadow). Shadow observations live apart from the resolution record.
- **Stake**: claim, the two addresses, amount, deadline, state, settlement reference — held on-chain.
- **Settlement outbox row**: one per locked price-feed claim — its hash, the open authorization, the outcome once final, state, attempts, a transaction reference per stake, last error.
- **Wallet link**: X user id, wallet family, address, when it was verified, when and by which half it was revoked.
- **Wager reply**: claim, which kind of reply (the link, or the reason it was refused), the mention it
  answered, when. One per claim and kind; it is what makes "one link per claim" hold across restarts.

## Success Criteria *(mandatory)*

- **SC-001**: The page answers "is it running" in its first line and fits one screen at 1280px without
  scrolling, with every unhealthy job named. Stated as a property of the page, because "a newcomer
  understands it in half a minute" is a judgement no task can check.
- **SC-002**: Any single job stopping is visible on the page as STALE within two minutes of its own
  stale-after window passing — not two minutes after a missed run, because a twice-daily job and a
  once-a-minute job are not late at the same point.
- **SC-003**: A capacity table exists with every number measured, none estimated, each dated and tied to the
  hardware it was measured on. Met for this machine 2026-10-13 ([capacity.md](capacity.md)); the droplet's
  rows are named as unmeasured rather than filled in from the laptop's.
- **SC-004**: A synthetic mention burst at ten times the live rate is answered exactly once per mention, with
  no duplicate reply and no mention lost, and the backlog drains without intervention.
- **SC-005**: **Zero wrongly auto-finalised claims on the held-out set.** This is the gate that sets the
  threshold, and it is a statement about that set — not a proof that the fast path cannot err in production,
  which is why shadow mode and the contradiction counter exist.
- **SC-006**: The share of resolutions that avoid a paid call is measured and written down, whatever it is.
  An honest 5% is a valid result and a reason to keep the fast path simple; it is not a reason to lower
  SC-005. UNRECONCILED until measured.
- **SC-007**: Average model spend per claim falls measurably against the recorded baseline, and stays below
  the $0.30 per-claim ceiling without relying on the cap to stop it.
- **SC-008**: All processes together fit the VPS with stated headroom, measured, not assumed.
- **SC-009**: Turning the fast path off returns the system to today's behaviour exactly, with no migration
  and no deploy.
- **SC-010**: A full round trip on a public testnet — open, accept, deadline, verdict, payout — with no manual
  wallet interaction after the stake is accepted.
- **SC-011**: The timeout refund works with the worker switched off for the whole window, triggered by a party
  rather than by us.
- **SC-012**: No stake is ever settled twice, and no settlement ever happens for a verdict that is not final,
  across the whole test campaign.
- **SC-013**: An independent reading of the contract confirms there is no path by which the operator can move
  staked funds — demonstrated by tests that try.
- **SC-014**: The contract's tests cover every branch of settle and refund, the standard the gates and the
  resolver are held to rather than the ~55% repository target.
- **SC-015**: A full stake, settled, with no wallet ever linked — proving linking is optional and not on the
  critical path.
- **SC-016**: A code returned by an account other than the one it was issued to never produces a link, and
  the attempt is logged with both account ids and never the code — the status page has no read on links.
- **SC-017**: A stake on a model-judged claim is impossible to create, proved by trying: refused by the
  page, refused by the outbox, and refused by the contract, which has no authorization for it.
- **SC-018**: On the testnet run, the payout cannot be pulled early and can be pulled by a third address
  after the window; a void inside the window refunds both and pays nobody; a void after it is refused.
- **SC-019**: Every item in FR-031f is answered in writing before the contract is deployed anywhere, test
  network included — because the answers cannot be added to a deployed contract.
- **SC-020**: Story 5's independent test passes on a short-window testnet deployment with two real browser
  wallets, four wagers, one per ending: paid out after the hold, VOID, offer returned, timeout refund with
  the worker stopped. The deployed contract's real 72-hour and 14-day numbers are covered by the contract's
  time-warp tests (T329), not by waiting.
- **SC-021**: Across a burst of `wager` posts on one claim, exactly one reply carries a link; a refused
  request before lock leaves that link unused; nothing is posted for `wager` outside a claim's thread.
- **SC-022**: The page never shows a wager as opened, matched, paid or refunded before the chain does, tested
  with a transaction left pending and one that reverts.

## Assumptions

- The status page is for the owner and for anyone being shown the project; it is not a public product
  surface, and it carries no claim text or user data beyond what the public claim pages already show.
- The progress block is maintained by hand on purpose. Deriving it from tasks files was considered and
  rejected: a plan that needs editing is more honest than a progress bar computed from checkboxes.
- Load testing runs locally against a Docker database. Measurements from a laptop and from the VPS are
  recorded separately, because only the second answers "will the droplet hold".
- Both a thresholded off-the-shelf entailment model and a small fine-tuned encoder get built and measured on
  the same held-out set. Neither is assumed to win: the trained model may fail to beat a stock model with a
  well-chosen threshold, and knowing that costs one training run and settles the question. Whichever wins on
  the stated criteria is what runs. The paid model stays the arbiter either way; this is a filter in front of
  it, not a replacement.
- The held-out evaluation set is the existing seeded claims plus real verdicts already produced. If it is
  too small to trust a measurement, the fast path stays off — a small set is a reason to wait, not a reason
  to lower the bar.
- A second runtime is accepted for the service layer only. The bot, the resolver and anything that posts to
  X stay in TypeScript. This feature changes them only where Story 5 says: the `wager` command, its reply
  and the claim routes; Story 4's lock writing the outbox row and the confirm step before the resolver.
- The chain is a cheap EVM layer 2, on its testnet. Stablecoin-denominated if it ever leaves a testnet, which
  it may never do.
- **The wager page is in Stage 2** (owner decision 2026-10-19, replacing "no stake page in Stage 2"): the
  testnet path passed from the command line, and a contract nobody can reach from a page proves nothing to
  the people it is for. Story 5 builds it; it needs no wallet link (FR-032).
- The contract is Solidity. A Python-syntax alternative exists and is rejected for funds-holding code: a
  smaller reviewer pool, and a compiler bug that once cost a protocol tens of millions.
- Whether a fee is ever taken, and what would have to be registered first, is deliberately outside this spec.
- The wallet-link page and the wager page are the only places in this feature that accept input from a
  person, and the only pages with a script: signing needs the wallet in the browser. One small vanilla
  script shared by the two (FR-045) — no framework (constitution VII), and every other page stays
  server-rendered without one. The wager page keeps no session at all. The link page holds a
  short-lived session and nothing else: no password, no email, no account. The session is a random token in a
  Secure, HttpOnly, SameSite cookie, stored only as a hash. This is not user auth returning
  through the back door (constitution VII) — there is nothing to log into, and a link can be revoked without
  losing the history it covered.
