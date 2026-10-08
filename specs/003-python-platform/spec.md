# Feature Specification: Operations, capacity and cost

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
   time, runtime version, uptime), each job's last run and outcome, claim and verdict counts, spend against
   the per-claim ceiling, and the feed's state — read from the database, the build-info file and the
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

### Edge Cases

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
- **Two runtimes drift**: the Python service and the Node service share nothing but the database. No shared
  files, no shared memory, no in-process calls between them.

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
- **FR-004**: The status page is not publicly reachable. The public server keeps serving only claim pages,
  author pages and health (001 `contracts/http.md`).
- **FR-005**: The status page renders server-side with no client-side JavaScript, matching the existing
  public pages, and renders a usable page when the database is down.
- **FR-006**: A machine-readable twin of the status page exists (one JSON response with the same numbers),
  so a future uptime check or a script needs no HTML parsing.
- **FR-007**: The progress block is read from one file the owner edits by hand; the page shows that file's
  last-changed date. The service never writes it.
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
- **FR-013**: The fast path may finalise a verdict only when all of these hold: confidence above the
  threshold, at least two passed evidence items agreeing that the **existing independence gate** counts as
  independent (001's definition is reused, not redefined — two excerpts from one page are one item), every
  existing deterministic check passing, and no numeric, date or entity conflict between claim and evidence.
  Anything else escalates to the paid model. One resolution per claim stays the rule (constitution II).
- **FR-014**: Absence of evidence is VOID, never MISS, on the fast path exactly as on the slow one
  (constitution II; a source outage is still never a verdict, INIT_SPEC §6.7).
- **FR-015**: Every resolution records **who actually decided it** and that decider's version. A verdict the
  paid model decided says so, even when the local model also had an opinion.
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
- **FR-021**: The Python side has its own tests, run in CI alongside the existing suite. The verifier's
  gate is exhaustively tested, like the other gates and the resolver; the status page is not (project rule:
  ~55% coverage is a cap, not a floor).

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

## Success Criteria *(mandatory)*

- **SC-001**: The page answers "is it running" in its first line and fits one screen at 1280px without
  scrolling, with every unhealthy job named. Stated as a property of the page, because "a newcomer
  understands it in half a minute" is a judgement no task can check.
- **SC-002**: Any single job stopping is visible on the page as STALE within two minutes of its own
  stale-after window passing — not two minutes after a missed run, because a twice-daily job and a
  once-a-minute job are not late at the same point.
- **SC-003**: A capacity table exists with every number measured, none estimated, each dated and tied to the
  hardware it was measured on. UNRECONCILED until the first run produces it.
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
  X stay in TypeScript, unchanged by this feature.
