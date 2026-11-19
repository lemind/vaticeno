# Tasks: `@vaticeno odds`

**Input**: `specs/006-odds-command/spec.md`, `plan.md`, `docs/decisions/009-odds-command.md`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Decision and rules

- [x] T601 ADR `docs/decisions/009-odds-command.md`; spec, plan and tasks under `specs/006-odds-command/`.
- [ ] T602 Constitution VI 2.10.0 → 2.11.0 in `.specify/memory/constitution.md`: odds only in a reply to the `odds`
  command, no bookmaker named, no link, never in the feed; `CLAUDE.md` version line and active feature;
  `docs/content-rules.md` and 005 FR-016 point to the exception.

## Phase 2: The command (US1)

- [ ] T603 [P] [US1] `src/bot/odds-format.ts`: decimal → nearest common fractional price; the reply text with
  "about, from N bookmakers"; tests in `src/bot/odds-format.test.ts`.
- [ ] T604 [P] [US1] `src/llm/instructions/odds.v1.md` and the Zod schema of the answer.
- [ ] T605 [US1] `src/bot/odds.ts`: the event from the thread's claim or the post; one grounded call; keep outcomes
  with two or more prices; average; the "no prices" and "name the event" replies; cost recorded.
- [ ] T606 [US1] `src/bot/commands.ts` + `src/bot/mentions.ts`: `odds` matched and routed, one reply per mention;
  "odds are …" with numbers stays a prediction. Tests in `src/bot/commands.test.ts` and
  `tests/integration/` (one reply; the search down → retried, never twice).

## Phase 3: Races (US2)

- [ ] T607 [US2] Race shape in `src/bot/odds-format.ts`: five shortest prices and one range, within one post;
  reuse `src/content/race-post.ts` helpers. Tests.

## Phase 4: Help and site (US3)

- [ ] T608 [P] [US3] `src/replies/templates.ts`: `odds` in `HELP_REPLY` (still fits); `src/web/home-page.ts`: a row in
  the command table; `README.md` commands.
- [ ] T609 Version 1.14.0 in `package.json`, `CHANGELOG.md` entry; measure the cost per reply in the first week (SC-003).

## Dependencies

T602 before any code ships. T603, T604 → T605 → T606. T607 after T603. T608 any time.
