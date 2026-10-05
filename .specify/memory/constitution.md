<!--
Sync Impact Report
- Version change: 2.2.0 → 2.3.0 (2026-10-04, MINOR): VI — the final verdict is posted once as a reply in the
  claim's thread, under the author's summon (owner decision); part of the same interaction, capped per day.
- Earlier: 2.1.0 → 2.2.0 (2026-09-30, MINOR): IV — STOP lasts until the author tags the bot again
  (owner decision), not permanently.
- Earlier: 2.0.0 → 2.1.0 (2026-09-30, MINOR): VI — mention-triggered replies need no separate X
  approval (owner decision); unsolicited replies stay forbidden.
- Earlier: 1.1.0 → 2.0.0 (2026-09-30, MAJOR): II redefined — no curated site list; the
  judge model rates each page primary/established/weak, code caps primary to the price feed and
  the contract's own source domain; sites earn "known" standing after 5 agreeing final verdicts
  (search hint only). III — entity_gone from a primary source.
- Earlier: 1.0.0 → 1.1.0 (2026-09-29, MINOR): I — lock version + hash recorded, edited
  posts re-checked, never locked against a version they weren't built from; II — official only
  from the curated source policy, highest trust level decides; III — entity_gone needs 3 runs;
  coverage cap 55%.
- Earlier: (template) → 1.0.0
- Principles defined (all new):
  I. The Lock Is Immutable
  II. Checkable by Construction (open topics; gated evidence from several sources; one resolution
      per claim — agree, arbiter, or human review; proof checked in code; no evidence = VOID). Supersedes INIT_SPEC 1.1.1's
      deterministic-only scope.
  I. amended in draft: lock = 15 min after last reply; before lock, amends and tweet edits replace
     the contract with a new [AMENDED] reply; after lock nothing changes.
  III. An Outage Is Never a Verdict
  IV. Speak Only When Spoken To
  V. IDs, Not Text
  VI. Platform Policy Gates Live Behavior
  VII. Boring by Design
- Added sections: Operational Constraints; Development Workflow & Quality Gates; Governance
- Removed sections: none
- Templates:
  ✅ .specify/templates/plan-template.md — "Constitution Check" reads gates from this file; no edit needed
  ✅ .specify/templates/spec-template.md — no mandatory-section change required
  ✅ .specify/templates/tasks-template.md — no new task category required
  ✅ CLAUDE.md — SPECKIT block now points at this constitution
  ✅ AGENTS.md, README.md — consistent; no edit needed
- VI amended 2026-09-30: mention-triggered replies go live without separate X approval.
- Deferred TODOs: none
-->

# Vaticeno Constitution

Vaticeno is an X bot that locks a public prediction into a machine-readable contract and resolves
it automatically and deterministically on the deadline. Its only product is trust: a referee
nobody can accuse of changing the question or guessing the answer. Every principle below protects
that. `INIT_SPEC.md` is the build spec; where it and this constitution disagree, this document wins
until one of them is amended.

## Core Principles

### I. The Lock Is Immutable

- Once `lock_at` has passed, the contract and deadline MUST NOT change, enforced in the database. Any change
  is a new claim.
- Before lock, an amend or an edit of the original tweet replaces the contract of the same claim and
  is announced in a new `[AMENDED]` reply (the bot never edits its own replies). An edited post goes
  through the same checks; a contract is never locked against a post version it was not built from.
  After lock, nothing changes it.
- At lock, the exact version of the user's tweet (version ID + hash of its text, never the text) is
  recorded and never changes, so "which version did you lock?" always has an answer.
- A claim locks 15 minutes after the last contract reply to its author; a valid amend restarts the
  wait. A deadline that passes before lock MUST end in `expired`. An unlocked contract is never
  judged.
- State transitions are enforced by the database; terminal states never change.

Rationale: if the question can move after it is asked, no verdict means anything.

### II. Checkable by Construction

- Any topic may be recorded, with no category allow-list, but only as a contract that states what
  must happen, by when (UTC), where the answer is read (a named authoritative source) and how "no"
  is established. The model proposes it; deterministic checks accept or reject it.
- Ambiguous meaning is `needs_info`, never a guess (e.g. intraday "touches" MUST NOT be mapped onto
  a daily-close check).
- Every claim is judged from evidence (for prices, the deterministic feed comparison alone;
  otherwise several web sources). Each evidence item must pass gates — source not weak, quote found
  in the fetched page, event inside the window, final result, independent — or it does not count.
- There is no fixed list of sites. Each evidence item has a trust level — primary (the body that
  decides the outcome), established (an outlet with its own reporting) or weak (never counts) —
  rated by the judge model per page, with its reason stored. Code caps it: primary only for the
  price feed or a page on the contract's own source domain (fixed at lock); any other page is at
  most established. One resolution per claim: one passed primary item, or two passed established
  items agreeing, is final; only the highest trust level present decides; disagreement within it
  goes to a model arbiter, which decides with notes or flags the claim for human review; a single
  established item without a primary one is flagged for human review. Models judge only against
  the locked contract.
- Sources earn standing, they are not granted it: a site whose evidence agreed with 5 or more final
  verdicts becomes a known source and is searched first. Standing guides search only; it never
  raises a trust level or decides a claim.
- Evidence MUST point to its proof (link + fingerprint of what was read), and the proof is checked
  in code (the model's quote must exist in the fetched page; the quote itself is not kept). HIT needs positive evidence the event occurred after lock and by the deadline;
  MISS needs a final contradicting result or absence from a source where absence is meaningful;
  otherwise VOID. Absence of evidence elsewhere MUST NOT become MISS. Repeated copies of one report
  count as one source.
- Every evidence item stores its source, proof, gate results and model identity; the resolution
  stores how it was reached and its notes; the public page shows both.

Rationale: a referee is trusted for the question it fixed in advance and the evidence it shows,
not for the confidence of its answer.

### III. An Outage Is Never a Verdict

- A source that is unreachable, erroring or malformed yields no answer: retry on the next run.
  It MUST NOT void a claim.
- Only a primary source that answers but no longer has the entity (delisted coin, deleted
  fixture), confirmed in 3 separate runs, may make a claim VOID ("unresolvable").
- A failed existence check MUST NOT trigger a retried post. Unknown state means wait, not act.
- Failures MUST be visible: retryable errors back off, exhausted ones alert. Nothing is dropped
  silently.

Rationale: our downtime must never cost a user their verdict, and a guess is worse than a delay.

### IV. Speak Only When Spoken To

- The bot replies once per inbound user interaction, in the thread it was summoned in. It MUST NOT
  create standalone posts that mention a user.
- Only the author of a prediction can put it on the record; a summon on someone else's post is
  rejected.
- Self-imposed rate caps MUST be enforced in code: 3 replies per author per hour and 300 per day,
  halting and alerting on breach.
- Opt-out (`STOP`) is honored until the author tags the bot again (owner decision 2026-09-30); the author's locked claims still resolve, to the page
  only.
- Mention processing uses a guarded lease: a worker that lost its lease MUST NOT cause side
  effects.

Rationale: the bot is a guest in other people's conversations. Restraint keeps it welcome and
keeps the account alive.

### V. IDs, Not Text

- No content is stored — not X post text, not quotes or snapshots of external sources; not in the
  database, not in logs. Only IDs, links, hashes and our own derived contract are kept.
- `x_user_id` is identity; a handle is a display cache refreshed from API responses.
- Official API only. No scraping, no bulk export, no training on or redistribution of X content.

Rationale: this removes deletion tracking, edit reconciliation and redistribution risk as an
entire class of problems, and it is what X's terms require.

### VI. Platform Policy Gates Live Behavior

- Live replies are gated by `REPLY_ALLOWLIST_USER_IDS` (`*` = anyone) and the self-imposed caps.
- Replies go only to people who mentioned the bot, in that thread, once per interaction. X allows
  mention-triggered replies without separate approval (owner check of X's developer forum, 2026-09-30);
  the account carries X's "Automated" label and names its operator in the bio. Anything unsolicited
  (keyword search, replying where not mentioned) is forbidden. One exception, part of the same interaction:
  the claim's final verdict is posted once as a reply in its thread, under the author's summon (owner
  decision 2026-10-04), through the same allowlist and caps; never to an author who sent STOP.
- There are no topic exclusions, but content the bot republishes MUST comply with X's rules.
- Behavior that depends on X's answers (third-party recording) MUST be configuration, not code, and MUST
  default to the most conservative option. Verdict delivery is a reply in the thread (owner decision).

Rationale: the account is the product's only distribution channel. Losing it ends the experiment.

### VII. Boring by Design

- KISS over DRY; no abstraction before its third real use; explicit over clever.
- Deliberately absent until justified by measurement: Redis, message brokers, frontend
  frameworks, user auth, payments, microservices. (Web search is allowed, for model resolution.)
- New dependencies require explicit approval and a stated reason.
- Every external boundary (X, LLM output, data sources, env, HTTP input) is validated with Zod.
  Every enum column carries a database CHECK constraint.

Rationale: a one-person proto survives on code it can read in one sitting.

## Operational Constraints

- All timestamps are UTC. A bare date means `23:59:59 UTC`, and replies say so.
- Secrets live only in environment variables and uncommitted state files. Anything pasted or
  exposed MUST be rotated before public launch.
- Logs are structured JSON with correlation IDs (e.g. `claim_id`); no bare `console.log`.
- Exactly one instance runs. A second instance requires advisory locks on the poller and cron first.
- Every X and LLM call is cost-logged. Unmeasured prices stay labelled UNRECONCILED until measured.
  Above $0.30 per claim: stop and investigate.
- A fatal configuration or auth error stops the service; it MUST NOT crash-loop.

## Development Workflow & Quality Gates

- Staged rollout per INIT_SPEC §14: offline first, then read-only, then shadow resolution, then
  human review, then live. A stage starts only when the previous one is done.
- Tests go where bugs cost trust: gates, the resolver, the mention/posting lifecycle and parsing
  are exhaustive (including crash-window and lease-race cases). Elsewhere, ~55% coverage is a cap,
  not a floor.
- Specs and code move together: behavior, scope, stack or layout changes update the matching
  artifacts under `specs/` in the same change.
- Scope discipline: do what was asked, nothing more; anything beyond it is asked first.
- Commits are one line, `type(spec-task): description`, with no attribution trailers. Work lands
  through branches and pull requests, never directly on `main`.
- Provider-quirk code carries a `HACK(scope)` tag with a `REVISIT` condition.

## Governance

- This constitution supersedes other practice documents. `AGENTS.md` and `CLAUDE.md` hold working
  rules and MUST NOT contradict it.
- Amendments are made by pull request that states the change, the reason and the version bump,
  and updates dependent templates and guidance in the same change.
- Versioning: MAJOR for removing or redefining a principle, MINOR for a new principle or
  materially expanded guidance, PATCH for wording and clarification.
- Every plan passes the Constitution Check before design and again after it. A justified violation
  is recorded in the plan's Complexity Tracking table; an unjustified one blocks the work.

**Version**: 2.3.0 | **Ratified**: 2026-09-28 | **Last Amended**: 2026-10-04
