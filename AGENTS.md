# AGENTS.md — Vaticeno

## Philosophy

- Prefer KISS over DRY.
- Duplication is acceptable if abstraction harms readability.
- Avoid abstractions before the third real use case.
- Prefer boring, maintainable solutions.
- Explicit code over clever code.
- Measure before optimizing. Prefer profiling and instrumentation over assumptions.

## Communication

- Ask clarifying questions before acting on ambiguous requirements.
- State assumptions explicitly when information is missing.
- Propose concrete next steps, not general suggestions.

## Security & Privacy

- Never commit secrets, tokens, or `.env` contents. Secrets come from env vars only (INIT_SPEC §2).
- Mask credentials in logs; use parameterized queries only.
- Flag hardcoded paths, IPs, or emails before committing.
- Never store a copy of X post text — IDs only (INIT_SPEC §6.9). No scraping of X, ever.

## Code Style & Consistency

- Follow project linter/formatter rules (ESLint, Prettier, etc.).
- Do not disable linters or skip formatting to "fix" a bug.
- Match existing naming conventions; do not rename variables without scope.
- **Naming**: Use descriptive names that make purpose obvious (`acquireMentionLease`, `resolveClaim`, `postResolutionReply`). Avoid generic names like `fetch`, `data`, `result`, `check`, `cleanup`, `doStuff`. Don't over-verbose — `lockClaim` is good, `lockClaimAfterEditWindowExpires` is not.

## Git & Version Control

- Commit atomically: one logical change per commit.
- Keep commit messages short and descriptive. Example: `feat: add mention reaper` — not `feat: add mention reaper with lease expiry and exponential backoff`. If you need details, put them in the body.
- Task ref, when there is one: spec number + task, e.g. `feat(004-T012): …` (bare T0XX repeats in every spec).
- Never force-push or rewrite history without explicit approval.
- **NEVER push to `main` directly.** All work goes to feature branches. Pushing to `main` is strictly forbidden without explicit human approval.

## Architecture

- API routes must stay thin.
- Business logic belongs in services, not route handlers or cron callbacks.
- Never place prompts inside route handlers.
- Avoid framework lock-in where practical.
- Prefer existing platform/framework capabilities before adding libraries.
- Database migrations must be reversible and reviewed before applying.
- Do not add feature-specific architecture, paths, or constraints here — those belong in `specs/<feature>/plan.md`.

## AI Rules

- The LLM writes the contract; deterministic checks accept or reject it.
- Resolution: evidence items (price feed, web pages read by an LLM) pass code gates; passed evidence that agrees is final, contradictions go to an LLM arbiter or a human-review flag. No evidence = VOID, never MISS (constitution II).
- Use structured JSON outputs only.
- Validate all AI outputs through Zod.
- Prefer cheaper models first.
- Keep prompts centralized and versionable.

## Error Handling & Validation

- Validate at boundaries (API, DB, external services) with Zod.
- Wrap third-party calls in try/catch with structured error tags.
- Never `catch` and ignore; always log context or rethrow.
- Use TypeScript contracts internally for type safety.
- A source outage is never a verdict: retry, never void (INIT_SPEC §6.7).

## Testing

- Match test type to change: unit for logic, integration for APIs/DB, e2e for user flows.
- Run relevant tests iteratively; run full suite before finalizing.
- Mock external services; never skip tests due to flakiness without documenting why.
- Target ~55% test coverage (MVP), no more — don't chase coverage numbers past that; put effort into tests that catch real bugs (gates, resolver, lease/posting lifecycle, edge cases), not into padding coverage on straightforward/generated code.

## Spec-kit & `specs/` (keep in sync)

`INIT_SPEC.md` is the product/build spec. Feature work lives under `specs/<feature>/` (see `.specify/feature.json` → `feature_directory`). After **any** change that affects behavior, scope, architecture, stack, file layout, env vars, or delivery status, update the matching artifacts.

| Change type | Update |
|-------------|--------|
| Product scope, user flows, acceptance criteria | `spec.md` (and `INIT_SPEC.md` if it contradicts it) |
| Tech stack, folder structure, phases, constraints | `plan.md` |
| Task status, new work items, path corrections | `tasks.md` |
| Spec quality / readiness gates | `checklists/*.md` |

**Rules**

- Do not leave code and specs diverged: if you change the implementation, update the spec docs in the same PR/commit series (or explicitly note why deferral is safe).
- When `plan.md` structure or paths change, propagate to `tasks.md` (exact file paths, phase names, checkpoints).
- When `spec.md` requirements change, check whether `plan.md` phases and `tasks.md` still cover them; add or adjust tasks if not.
- Mark completed work in `tasks.md` (`[x]`) and reflect current status in root `README.md` when deployability or stage milestones shift.
- `spec.md` stays technology-agnostic where possible; stack and paths belong in `plan.md` / `tasks.md`, not in functional requirements.
- **Phase immutability**: Once a phase is marked complete (`✅`), never add new items to it. New work goes into the current/last active phase (or a new sub-phase under it).
- **Chronological ordering in tasks.md**: Add new sub-phases to the **end** of the current phase. Sub-phase letters (`4a`, `4b`, `4c`) reflect actual completion order, not planned order.

## Workflow

- Implement incrementally.
- Verify after every meaningful change (smoke test + relevant tests).
- Do not rewrite unrelated files.
- Preserve existing architecture unless explicitly requested.
- Treat spec/plan/tasks updates as part of the change, not a follow-up chore.

## Scope Discipline

**Do only what was explicitly asked. Everything else is out of scope.**

- If the user asks to update spec files, do not touch source code.
- If the user asks to fix a bug, do not refactor surrounding code.
- If the user asks to implement Stage 0, do not start Stage 1.
- When in doubt whether an action is in scope: **don't do it, ask first.**

This applies even if the extra work seems obviously correct, helpful, or "the right thing to do." The user may have a reason for the narrow scope. Unsolicited work wastes review time and can conflict with the user's plan.

## Autonomy

### Act without asking:
- Fix typos, lint errors, or obvious bugs
- Add missing error handling or null checks
- Improve tests within the same module
- Refactor ≤1 file with zero behavior change

### Ask before acting:
- Changes affecting >3 files or >2 modules
- Modifying configs, CI/CD, or deployment scripts
- Adding/removing dependencies or changing versions
- Altering public routes, DB schemas, or the claim state machine
- Anything that posts to X or spends API credits
- Committing code — show summary of changes first, ask user to review before running `git commit`
- **Any work beyond the explicitly stated task — even if it seems related or necessary**

## Forbidden

- Premature abstractions.
- Global state unless justified.
- Silent failures.
- Hidden magic behavior.
- Microservices.
- Deliberately absent tech (constitution VII): Redis, message broker, frontend framework, user auth, Stripe, microservices.
- Force-pushing or history rewriting.
- Committing secrets or `.env` files.
- Adding new dependencies without explicit approval and justification in PR.
