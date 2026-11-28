# Feature Specification: `@vaticeno odds` — approximate bookmaker odds on request

**Feature Branch**: `odds-command`

**Created**: 2026-11-19

**Status**: Draft

**Input**: Owner, 2026-11-19: "we write `@vaticeno odds`, you go to two or three bookmakers, get approximate odds and
reply with them" — fractional (2:1, 1:2) with decimal beside it (3.00, 1.50), no American odds; for a race the first five and a range for the rest; no bookmaker
named, no daily cap; listed in help and on the site. Decision record: `docs/decisions/009-odds-command.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Odds for a match (Priority: P1)

Under a post about Arsenal v City, someone tags `@vaticeno odds`. The bot replies once, in that thread:
`Arsenal v Man City: City 6:5 (2.20) · Arsenal 2:1–9:4 (3.00–3.25) · Draw 5:2 (3.50)`.

**Why this priority**: the command itself; everything else extends it.

**Independent Test**: with the search stubbed to give two bookmakers' prices, one mention gets one reply with every
outcome in fractional and decimal odds and the count of bookmakers, no bookmaker name and no link.

**Acceptance Scenarios**:

1. **Given** a post about a priced event, **When** `@vaticeno odds` is tagged under it, **Then** one reply lists each
   outcome with the range of at least two bookmakers, in fractional odds with decimal beside it, and nothing else.
2. **Given** a recorded prediction in the thread, **When** `odds` is tagged, **Then** the event is the one its contract
   names.
3. **Given** only one bookmaker found, or none, **When** `odds` is tagged, **Then** the reply says no bookmaker prices
   it, and gives no number.
4. **Given** a whole conversation, read once, that names no event at all, **When** `odds` is tagged, **Then** the
   reply says which event to name — the one case of asking ("Infer, never interrogate": genuinely absent).

### User Story 2 - Odds for a race (Priority: P2)

Under a post about a race, `@vaticeno odds` gets the five shortest prices and one range for the rest:
`Golden Sixty 2:1–9:4 (3.00–3.25) · … · rest 12:1–50:1`.

**Independent Test**: twelve runners priced by two bookmakers give five named prices and one range, within one post.

### User Story 3 - Found in help and on the site (Priority: P3)

`@vaticeno help` and the site's command table list `odds`.

**Independent Test**: the help reply and the front page both contain the command and fit their limits.

### Edge Cases

- Prices that disagree wildly between bookmakers show as a wide range.
- An event already finished: no bookmaker prices it → the "no prices" reply.
- An event under way (owner, 2026-11-21): no in-play odds, ever → "It's live now — I don't give in-play odds."
  The search says whether the event is upcoming, live or finished (instruction `odds.v5`).
- Prices count only from pages the search read: an answer with none is the model's memory (2026-11-28, Oliveira v
  Lopes under a UFC 335 poster), searched again, then "no prices". A card named without a fight means its main event.
- An upcoming event with no prices on the first search is searched once more before "no prices", this time for
  the event by name with "odds": fights other bots priced came back empty (2026-11-21 Shoaib Yousaf v John
  Mitchell; 2026-11-28 Baisangur Susurkaev v Damian Pinas). Each lookup logs what it searched for.
- `odds` as the first word, or "what are the odds", is the command, numbers included ("odds pls", "odds for UFC
  310"); "odds are / is / say …" ("odds are BTC hits 100k") is a prediction for the model to read (review
  2026-11-21). If X cannot read the post replied to or quoted, the mention is retried, never answered. Anywhere
  else in a short post (six words or fewer) the word is the command too ("Spivac odds", owner 2026-11-24), unless it
  is an idiom ("against all odds", "beat the odds") or the post quotes a price ("Kabayel 1/16"): that is talk.
- Every mention is answered (001 FR-008a, 2026-11-26), so `odds` under the bot's own answer or in a busy thread
  is answered too.
- The search is down: no reply that run; the mention is retried, never answered twice (INIT_SPEC §6.7). An outage
  is never answered "no bookmaker prices it"; only an answer that came back and gave fewer than two prices is.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `odds` is a command, matched like the others; one reply per mention, in its thread (constitution VI).
- **FR-002**: The event is inferred: the thread's recorded prediction first, else the post and the whole conversation
  (read once, as for predictions); asked only when nothing in it names one (US1 scenario 4).
- **FR-003**: One web search per command asks for the latest prices of each outcome in the main market (result,
  fight winner, race win) at three bookmakers when found, at least two; the answer is structured and validated; code keeps outcomes
  priced by at least two bookmakers and shows their range, shortest to longest (one price when they agree). Every
  lookup logs its prices and source sites (owner 2026-11-19: our odds differed from another answer's).
- **FR-004**: Each price is shown in classic fractional form, rounded to the nearest common price, with its decimal
  odds beside it to two places (`2:1 (3.00)`); the race's range is fractional only. No American odds.
- **FR-005**: A race (more than six outcomes) shows the five shortest prices and one range for the rest; the reply
  fits one post — names are shortened, then fewer runners named, never "no prices" for being too long.
- **FR-006**: The reply is the odds alone (no "about, from N bookmakers", owner 2026-11-19); it names no bookmaker,
  carries no link, never a tip or
  "bet now"; these odds appear nowhere else — not in the feed, a verdict or a wager page. The weekly race post's
  own odds (005 FR-025) are unchanged.
- **FR-007**: No daily cap; every call's cost is recorded under its own operation, `odds`; existing per-author reply
  limits and STOP apply.
- **FR-008**: Nothing is stored but the cost row and the mention's answered id.
- **FR-009**: `odds` is listed in the help reply and in the front page's command table.

### Key Entities

- **Odds answer** (not stored): event name; outcomes, each with its bookmaker prices; the count of bookmakers.

## Success Criteria *(mandatory)*

- **SC-001**: Every `odds` mention gets exactly one reply.
- **SC-002**: No reply names a bookmaker, carries a link, or shows a price backed by fewer than two bookmakers.
- **SC-003**: The cost per reply is measured in the first week (UNRECONCILED: about 1–2 cents).

## Assumptions

- Bookmakers' own pages are not read by our code; the prices come from the search's answer (ADR 009).
- "Common prices" are the usual fractional ladder (1:100 … 1:16 … 1:1 … 5:2 … 100:1).
