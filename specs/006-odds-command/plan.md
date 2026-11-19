# Implementation Plan: `@vaticeno odds`

**Branch**: `odds-command` | **Date**: 2026-11-19 | **Spec**: `specs/006-odds-command/spec.md` | **ADR**: `docs/decisions/009-odds-command.md`

## Summary

A new bot command. The mention path already matches commands and replies once; `odds` adds one grounded model call
that returns bookmaker prices as JSON, code that averages and rounds them, and a reply template. The race shape reuses
the weekly race post's top-five-and-range code.

## Constitution check

| Principle | How it holds |
|---|---|
| II Checkable by construction | odds touch no verdict, contract or wager; the model's answer is validated by Zod and filtered by code (two bookmakers per outcome) |
| IV Opt-out | STOP applies as to any reply |
| V IDs, not text | nothing stored but the cost row and the answered mention id |
| VI Platform policy | **amended (2.11.0)**: odds only in a reply to the `odds` command, no bookmaker named, no link, never in the feed — the weekly race post's odds (005 FR-025) stay allowed; replies only where mentioned |
| VII Simplicity | no new table, no dependency, no new runtime |

## Design

- `src/bot/commands.ts`: `odds` joins `Command` and `ANY_WORDS`: matched as the first word with no number after it
  (the existing first-word path), plus the phrase "what are the odds". Not anywhere in a post, unlike `wager`.
- `src/bot/mentions.ts` `runCommand`: the event from the thread's claim (then no posts are read), else the post, the
  post it quotes and the whole conversation (`contextAround`).
- `src/bot/odds.ts` (new): `lookUpOdds(deps, input)` — one `groundedAnswer` with
  instruction `odds.v1`. Its answer is text: the JSON is cut out and `safeParse`d against `{ event, outcomes: [{ name,
  prices: number[] }] }` (decimal prices), as `src/content/race-run.ts` does. A parse or schema failure → "no prices";
  an outage (`LlmUnavailable`) is thrown, so the mention is retried and never answered with a guess.
  Keep outcomes with ≥2 prices, average, show fractional with decimal beside it.
- `src/bot/odds-format.ts` (new, pure): decimal → nearest price on the common fractional ladder (its own ladder, not
  race-post's `oddsText`, which keeps prices like 27:10), plus the decimal to two places; the reply text; the race
  shape (five shortest + a range, both ends on the ladder), with its own `TOP = 5`; names are shortened, then a race names fewer runners, until the reply fits.
- `src/llm/instructions/odds.v1.md` (new): asks for prices at two or more bookmakers, decimal, JSON only.
- `src/bot/mentions.ts`: `runCommand` routes `odds`.
- `src/replies/templates.ts`: help line `• odds → about what bookmakers give`; the "no prices" and "name the event"
  replies.
- `src/web/home-page.ts`: a row in the command table.
- Costs: `odds` joins `COST_OPERATIONS` (migration `0029_odds_cost`: the `cost_events_operation_check` constraint,
  reversible); `src/bot/odds.ts` records the grounded call's rows under `odds`, so no client change is needed.

## Tests

- Unit: fractional rounding ladder and the decimal beside it; averaging and the two-bookmaker rule; the race shape;
  every reply fits a post and carries no link or bookmaker name; command matching (`odds`, `odds pls`, "odds are BTC hits 100k" is not).
- Integration: one mention → one reply; the search down → no reply, retried, never twice.
