# 009 — `@vaticeno odds`: approximate bookmaker odds on request

**Date**: 2026-11-19 · **Decided by**: the owner · **Status**: accepted · **Changes**: constitution VI (odds allowed
in a reply to the `odds` command; the weekly race post keeps its own, 005 FR-025), a migration for the `odds` cost), `docs/content-rules.md` · **Spec**: `specs/006-odds-command/spec.md` ·
**Relates to**: constitution II, IV, VI; spec 005 FR-016, FR-025

## The problem

People tag the bot under a match or a race and want a quick sense of who is favoured. Today the bot has nothing to
say, and its rules forbid odds anywhere ("never a tip, odds…", 005 FR-016).

## The decision

1. **A command.** `@vaticeno odds` under a post: the bot replies once, in that thread, with approximate bookmaker odds
   for the event the post or its prediction is about. Nothing else is needed in the mention.
2. **Two formats.** Classic fractional odds — `2:1`, `1:2`, `5:2`, rounded to the nearest common price — each with its
   decimal odds beside it (`2:1 (3.00)`, `1:4 (1.25)`). No American odds: readers convert if they want them.
3. **The range of at least two bookmakers.** One web search through the model asks for the current prices of the
   event's outcomes at two or more bookmakers. Code requires two prices per outcome and shows their range, shortest
   to longest (`2:9–2:7 (1.22–1.29)`; one price when they agree); with fewer, the reply says no bookmaker prices it.
   Amended 2026-11-19: a range, not an average, as other answers give it (owner); every lookup's prices and source
   sites are logged, so a difference from another answer can be explained.
4. **No names, no links, nothing else.** The reply is the odds alone — no "about, from N bookmakers" (owner,
   2026-11-19) — and never names a bookmaker: we refer, we do not promote. The search is asked for three bookmakers
   per outcome, at least two; one search either way, so three cost no more. No link, as for every reply (constitution VI).
5. **Races.** The five shortest prices, then one range for the rest (the same shape as the weekly race post, 005 FR-025).
6. **No daily cap for now.** The usual one reply per mention and per-author limits apply. Every call's cost is recorded
   under its own operation, `odds`, so the cost per reply can be read (owner: all costs are written).
7. **Nothing stored.** The odds are said once and never kept; only the cost row is.

## What we give up

Verdicts rest on pages our code reads itself. These odds do not: bookmaker sites block servers and draw their prices
with scripts, so the numbers come from the search's answer. That is why the reply shows the range of several
bookmakers, and why these odds never touch a verdict, a wager or the own feed (the weekly race post keeps its
own odds, read from the Jockey Club's cards and priced as 005 FR-025 says).

## Why not

- **The bot's own estimate**: a prediction of its own, forbidden by constitution VI.
- **American odds as well**: a third format makes replies longer for few readers (owner).
- **Odds from wager stakes**: few claims carry stakes; it answers a different question. Can be added later.

## Revisit when

- X objects to odds in replies, or a reply is reported as gambling promotion.
- Spend on odds replies shows up in the weekly cost (then: a daily cap).
- People ask for odds on events bookmakers do not price, often enough to matter.
