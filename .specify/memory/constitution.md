<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Principles defined (all new):
  I. The Lock Is Immutable
  II. Checkable by Construction (open topics; feed-deterministic for crypto, model-decided
      elsewhere; no evidence = VOID). Supersedes INIT_SPEC 1.1.1's deterministic-only scope.
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
- Known exception recorded: the POC `ping` → `pong` reply is live before X approval (Principle VI).
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

- After `locked_at`, contract fields MUST NOT change. Any change is a new claim.
- The exact source-post version judged (`locked_source_tweet_id`, `locked_source_edit_count`)
  MUST be persisted at lock and never mutated.
- A claim MUST NOT lock before X's post edit window has passed (`editable_until`) and the
  challenge window has ended. Any pre-lock contract change MUST be announced
  (`CONTRACT UPDATED BEFORE LOCK`) and shown on the claim timeline — never silent.
- A deadline that passes before lock MUST end in `expired`. An unlocked contract is never judged.
- `claim_events` is append-only, enforced in the database.

Rationale: if the question can move after it is asked, no verdict means anything.

### II. Checkable by Construction

- Any topic may be recorded, with no category allow-list, but only as a contract that states what
  must happen, by when (UTC), where the answer is read (a named authoritative source) and how "no"
  is established. The model proposes it; deterministic checks accept or reject it.
- Ambiguous meaning is `needs_info`, never a guess (e.g. intraday "touches" MUST NOT be mapped onto
  a daily-close check).
- Where an exact data feed exists (crypto prices), the verdict MUST be a deterministic comparison.
  Everywhere else a language model decides, and only against the locked contract.
- A model verdict MUST cite its evidence. HIT needs positive evidence the event occurred after lock
  and by the deadline; MISS needs evidence it did not; otherwise the verdict is VOID. Absence of
  evidence MUST NOT become MISS. Repeated copies of one report count as one source.
- Every verdict stores its method (feed, model identity, manual) and evidence, and says on the
  public page how it was decided.

Rationale: a referee is trusted for the question it fixed in advance and the evidence it shows,
not for the confidence of its answer.

### III. An Outage Is Never a Verdict

- A source that is unreachable, erroring or malformed yields no verdict: retry on the next run.
  It MUST NOT void a claim or count as an undecided attempt.
- Only a source that answers but no longer has the entity (delisted coin, deleted fixture) counts
  toward `void`, and only after repeated confirmation.
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
- Opt-out (`STOP`) is honored permanently; the author's locked claims still resolve, to the page
  only.
- Mention processing uses a guarded lease: a worker that lost its lease MUST NOT cause side
  effects.

Rationale: the bot is a guest in other people's conversations. Restraint keeps it welcome and
keeps the account alive.

### V. IDs, Not Text

- No copy of X post text is stored — not in the database, not in logs. Only IDs and our own
  derived statement are kept.
- `x_user_id` is identity; a handle is a display cache refreshed from API responses.
- Official API only. No scraping, no bulk export, no training on or redistribution of X content.

Rationale: this removes deletion tracking, edit reconciliation and redistribution risk as an
entire class of problems, and it is what X's terms require.

### VI. Platform Policy Gates Live Behavior

- No reply type goes live before the X policy checklist (INIT_SPEC §10) is complete and approval
  is on file.
- **Recorded exception:** the proof-of-concept `ping` → `pong` liveness reply runs before
  approval. It is the only one; extending it or adding another requires amending this principle.
- Model-written replies (tailored NEEDS INFO, model-decided verdicts) make this an AI reply bot;
  X's written approval MUST be on file before they post.
- There are no topic exclusions, but content the bot republishes MUST comply with X's rules.
- Behavior that depends on X's answers (resolution delivery mode, third-party recording) MUST be
  configuration, not code, and MUST default to the most conservative option.

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
  are exhaustive (including crash-window and lease-race cases). Elsewhere, ~60% coverage is a cap,
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

**Version**: 1.0.0 | **Ratified**: 2026-09-28 | **Last Amended**: 2026-09-28
