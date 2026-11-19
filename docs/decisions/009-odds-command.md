# 009 — `@vaticeno odds`: approximate bookmaker odds on request

**Date**: 2026-11-19 · **Decided by**: the owner · **Status**: accepted · **Changes**: constitution VI (odds allowed
in a reply to the `odds` command, nowhere else), `docs/content-rules.md` · **Spec**: `specs/006-odds-command/spec.md` ·
**Relates to**: constitution II, IV, VI; spec 005 FR-016, FR-025

## The problem

People tag the bot under a match or a race and want a quick sense of who is favoured. Today the bot has nothing to
say, and its rules forbid odds anywhere ("never a tip, odds…", 005 FR-016).

## The decision

1. **A command.** `@vaticeno odds` under a post: the bot replies once, in that thread, with approximate bookmaker odds
   for the event the post or its prediction is about. Nothing else is needed in the mention.
2. **Two formats.** Classic fractional odds — `2:1`, `1:2`, `5:2`, rounded to the nearest common price — each with its
   decimal odds beside it (`2:1 (3.00)`, `1:4 (1.25)`). No American odds: readers convert if they want them.
3. **An average of at least two bookmakers.** One web search through the model asks for the current prices of the
   event's outcomes at two or more bookmakers. Code requires two prices per outcome and averages them; with fewer,
   the reply says no bookmaker prices it.
4. **No names, no links.** The reply says "about, from N bookmakers" and never names a bookmaker: we refer, we do not
   promote. No link, as for every reply (constitution VI).
5. **Races.** The five shortest prices, then one range for the rest (the same shape as the weekly race post, 005 FR-025).
6. **No daily cap for now.** The usual one reply per mention and per-author limits apply; each call's cost is recorded.
7. **Nothing stored.** The odds are said once and never kept; only the cost row is.

## What we give up

Verdicts rest on pages our code reads itself. These odds do not: bookmaker sites block servers and draw their prices
with scripts, so the numbers come from the search's answer. That is why the reply says "about" and averages several
bookmakers, and why odds never touch a verdict, a wager or the own feed.

## Why not

- **The bot's own estimate**: a prediction of its own, forbidden by constitution VI.
- **American odds as well**: a third format makes replies longer for few readers (owner).
- **Odds from wager stakes**: few claims carry stakes; it answers a different question. Can be added later.

## Revisit when

- X objects to odds in replies, or a reply is reported as gambling promotion.
- Spend on odds replies shows up in the weekly cost (then: a daily cap).
- People ask for odds on events bookmakers do not price, often enough to matter.
