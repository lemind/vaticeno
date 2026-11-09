# Vaticeno account: content rules

**Identity:** The world makes predictions. Vaticeno keeps score. Every post points back to prediction →
contract → evidence → result. Spec: `specs/005-x-growth/spec.md`; decision: `docs/decisions/008-x-growth.md`.

## Two channels

| The bot (automated) | The owner (by hand, in the X app) |
|---|---|
| one repost a day, an upcoming event only | bio, pinned post, header |
| the owner's queued posts, on their date | follows (5–10 a week) and three X Lists |
| Monday: claims coming due; Friday: the week's counts | quote posts of other people's predictions ("Not recorded on Vaticeno — yet.") |
| Tue–Thu: an upcoming event, confirmed by two sites, from a template | replies in conversations; any post with a link |

One own post a day, whichever kind; reposts are on top. No queued one-liners any more (owner, 2026-11-09): the
queue stays empty, and its 13:41 run only raises the Friday quiet-week alert.

## A week

| Day | Own post (one) | Reposts |
|---|---|---|
| Mon | claims coming due this week (08:17 UTC) || one |
| Tue–Thu | an event post with its poster (15:11 UTC), when two sites confirm one || one |
| Fri | the week's counts (09:47 UTC) || one |
| Sat–Sun | none || one |

## Repost policy

Vaticeno is not a news aggregator. A post is reposted only if it is an official announcement of an upcoming event
with a checkable outcome (owner, 2026-11-09: no one else's predictions, results or developments).

Never: highlights, routine results, memes, partisan argument, crypto hype, unrelated breaking news, giveaways, or
anything promoting betting. A cheap model call sorts the candidates (`src/llm/instructions/repost.v1.md`); only an
`event` is reposted, and no event means no repost. Following an account does not make its posts repostable.

## Links

The bot's posts carry no link: X bills Content: Create with URL at $0.20 against $0.015 for a plain post. An
event post names the event and its date and stops. A post the owner makes by hand costs nothing and may link.

## The owner's calls

Only authors on `FEED_SHOW_AUTHOR_IDS` (the owner alone for now) may be shown in an own post: their terms after
the lock, their verdict after the deadline, labelled as the author's call ("CALL · recorded on Vaticeno"), misses
included, never only the hits. The owner records two predictions a week, writes the post once the fact exists,
and queues it: `npm run content:queue -- add "…" [--on YYYY-MM-DD]`.

## Voice

Direct, a little playful, sceptical of vague predictions, neutral about teams, parties and market direction.
Never a tip, odds, "bet now", "to the moon", fake urgency or a prediction of Vaticeno's own. English.

## Event posts

Topics: `src/content/topics.ts` — ten sports (football, American football, basketball, tennis, F1, horse racing,
cricket, baseball, combat sports, golf) and eight others (crypto, central banks, economic data, earnings,
politics, tech, space, awards), all alike. `npm run content:topic` draws one by hand. A poster image (an abstract
picture of the sport, no text, no "Vaticeno") follows once the bot's X login can upload media.

## Every Friday (20–30 minutes)

1. Glance at what the bot posted this week; delete a bad one with `npm run post:delete -- <id>`.
2. Re-check any event post's date, a fixture again on its day.
3. Record two predictions of your own.
4. `npm run growth:week -- --quotes N` (N = your hand-made quote posts this week, from X), then X's dashboard
   and Cloudflare Web Analytics (host vaticeno.n30sk.cc).
5. Follow the week's 5–10 accounts (`specs/005-x-growth/content/accounts.md`).

## Repost pool (spec 002)

Once a day (09:23 UTC) the bot picks one account by weight, takes its eligible posts (no replies or reposts, at most 48 h
old, never posted by us before) and reposts the one that best fits the repost policy above; nothing fits → one
other account → else no repost. Quote posts of a pool account are refused by X's API (spec 002 FR-004).
Never the same account twice in a row, never the same post twice. The bot follows all pool accounts.

Score = popularity + virality + Vaticeno relevance (each 1–10, owner research 2026-10-05).
Weight = score − 15, so the top accounts come up about 5× as often as the weakest.
Chance = weight / 144 per pick; picks per month at 60 picks.

| Account | Field | Score | Weight | Chance | Picks/month |
|---|---|---:|---:|---:|---:|
| @FabrizioRomano | sport | 30 | 15 | 10.4% | ~6.2 |
| @AdamSchefter | sport | 30 | 15 | 10.4% | ~6.2 |
| platform account kept by the owner outside the repo | forecasting | 29 | 14 | 9.7% | ~5.8 |
| @NateSilver538 | statistics | 28 | 13 | 9.0% | ~5.4 |
| @Kalshi | forecasting | 27 | 12 | 8.3% | ~5.0 |
| @100trillionUSD | crypto | 27 | 12 | 8.3% | ~5.0 |
| @RaoulGMI | crypto | 25 | 10 | 6.9% | ~4.2 |
| @StatMuse | sport | 25 | 10 | 6.9% | ~4.2 |
| @OptaJoe | sport | 25 | 10 | 6.9% | ~4.2 |
| @OptaAnalyst | sport | 23 | 8 | 5.6% | ~3.3 |
| @OurWorldInData | statistics | 21 | 6 | 4.2% | ~2.5 |
| @gelliottmorris | statistics | 21 | 6 | 4.2% | ~2.5 |
| @metaculus | forecasting | 20 | 5 | 3.5% | ~2.1 |
| @Statsbomb | sport | 19 | 4 | 2.8% | ~1.7 |
| @ManifoldMarkets | forecasting | 19 | 4 | 2.8% | ~1.7 |
| **15 accounts** | | | **144** | 100% | 60 |

Left out: `@CryptoHayes` (unavailable on X since 2026-07-07), `@ESPNStatsInfo` (the handle no longer
belongs to ESPN — it now carries a betting brand, 2026-10-05), `@_1woonomic` (dormant, owner call
2026-10-05), `@saylor`, `@PeterSchiff`. A handle can
change hands: check an account before adding it, and the dry run's logged picks show who we would repost.
Scores and weights live in config next to each account's numeric id; the owner can change them.

## Starter posts (before inviting anyone)

1. Pinned intro (below)
2. Vaticeno doesn't make predictions. Vaticeno records yours.
3. "Soon" is not a deadline.
4. How it works: you say "BTC above $100k by Friday" → a precise contract → a verdict.
5. Vaticeno doesn't decide what you meant. It decides what the contract says.
6. Predictions fade. Records don't.
7. HIT, MISS, VOID: what each means.
8. A prediction without a deadline is a feeling.
9. Say it now. Put it on the record.
10. A joke about confidence.
11–13. Three PREDICTION SPOTTED quote posts (sport, crypto, science or tech).
14. The first real RECEIPT.

### Pinned intro (≤ 280 characters)

```
Vaticeno records predictions and checks them at the deadline.

1. Post a prediction with a date
2. Tag @vaticeno
3. Get the exact contract it will judge
4. After the deadline: HIT, MISS or VOID

Vaticeno doesn't make predictions. It records yours.
```
