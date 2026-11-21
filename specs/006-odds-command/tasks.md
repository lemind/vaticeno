# Tasks: `@vaticeno odds`

**Input**: `specs/006-odds-command/spec.md`, `plan.md`, `docs/decisions/009-odds-command.md`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Decision and rules

- [x] T601 ADR `docs/decisions/009-odds-command.md`; spec, plan and tasks under `specs/006-odds-command/`.
- [x] T602 Constitution VI 2.10.0 → 2.11.0 in `.specify/memory/constitution.md`: odds only in a reply to the `odds`
  command, no bookmaker named, no link, never in the feed — the weekly race post's odds (005 FR-025) stay allowed;
  `CLAUDE.md` version line and active feature; `.specify/feature.json` → `specs/006-odds-command`;
  `docs/content-rules.md` and 005 FR-016 point to the exception.

## Phase 2: The command (US1)

- [x] T603 [P] [US1] `src/bot/odds-format.ts`: decimal → nearest common fractional price with the decimal beside it
  (`2:1 (3.00)`); the reply text with "about, from N bookmakers"; tests in `src/bot/odds-format.test.ts`.
- [x] T604 [P] [US1] `src/llm/instructions/odds.v1.md` and the Zod schema of the answer (JSON cut out of the text
  answer, as `src/content/race-run.ts` does).
- [x] T604a [US1] The `odds` cost: added to `COST_OPERATIONS` in `src/db/schema.ts` with a reversible migration of
  `cost_events_operation_check` in `drizzle/0029_odds_cost.sql`; `src/bot/odds.ts` records its call's rows as `odds`.
- [x] T605 [US1] `src/bot/odds.ts`: the event from the thread's claim, else the post and the whole conversation read
  once; one grounded call; keep outcomes with two or more prices; average; "no prices" only for an answer that came
  back, "name the event" only when the conversation names none; an outage is thrown (retried, never a reply).
- [x] T606 [US1] `src/bot/commands.ts` + `src/bot/mentions.ts`: `odds` matched as the first word with no number
  after it, or "what are the odds", and routed; one reply per mention; "odds are BTC hits 100k" stays a prediction. Tests in `src/bot/commands.test.ts` and
  `tests/integration/` (one reply; the search down → retried, never twice).

## Phase 3: Races (US2)

- [x] T607 [US2] Race shape in `src/bot/odds-format.ts`: five shortest prices and one range, both on the ladder,
  within one post (own `TOP = 5`; names shortened, then fewer runners, until it fits). Tests.

## Phase 4: Help and site (US3)

- [x] T608 [P] [US3] `src/replies/templates.ts`: `odds` in `HELP_REPLY` (still fits); `src/web/home-page.ts`: a row in
  the command table; `README.md` commands.
- [x] T609 Version 1.14.0 in `package.json`, `CHANGELOG.md` entry.
- [ ] T609a The cost per reply read from `cost_events` (operation `odds`) after the first week live (SC-003).
- [x] T610 A quote post is read with the post it quotes (001 FR-033c, owner 2026-11-19): `postsAbove` in
  `src/bot/mentions.ts`; test in `tests/integration/bot.test.ts`.
- [x] T614 The ladder reaches heavy favourites (1/12 … 1/100): Kabayel's 1.06 read "1:10" beside Grok's 1/16.
- [x] T613 Live 2026-11-19: the reply is the odds alone, without "about, from N bookmakers"; the search asks for three
  bookmakers, at least two. And a handle carried into a thread that named us gets no reply (Grok's answer got the
  help reply): every conversation the bot is named in is remembered like one it replied in (`src/bot/mentions.ts`).
- [x] T612 The bookmakers' range instead of the average; every lookup's prices and source sites logged; `odds.v2`:
  main market, latest prices (owner 2026-11-19, after an answer differed from Grok's).
- [x] T611 Review fixes: no bare domain in a reply; too long shortens, never "no prices"; past 100:1 as N:1; no
  posts read under a recorded prediction; a lenient answer schema.

## Dependencies

T602 before any code ships. T603, T604, T604a → T605 → T606. T607 after T603. T608 any time.
