# Vaticeno account: content rules

**Identity:** Vaticeno is the public referee for predictions. Other people predict; Vaticeno remembers.
Every post should point back to prediction → contract → evidence → result.

## Mix

| Content | Share | Purpose |
|---|---|---|
| Vaticeno originals | 55–65% | identity, how it works, prediction principles |
| Receipts (real verdicts) | 15–25% | proof the machine does its job |
| Curated reposts / quote posts | 15–20% | link to the wider forecasting world |
| Jokes | ~5% | personality, not a meme account |

Never let one outside source dominate the feed. A visitor must not mistake the account for a crypto,
odds or betting feed.

## Series

- **ON THE RECORD**: a short principle. "Soon" is not a deadline. "A lot" is not a threshold.
- **PREDICTION SPOTTED**: quote a concrete public prediction from elsewhere: "Prediction spotted. Not
  recorded by Vaticeno. Yet." Pick it because the prediction is concrete, not because the author is famous.
- **RECEIPT**: a real verdict: `RECEIPT · HIT · BTC-USD daily close above $100,000 · Deadline Oct 2 ·
  Evidence: Coinbase`.
- **HOW IT WORKS**: the product in one post, explained rather than advertised.

## Rules

- No gambling calls to action, odds tips or "bet now". Joke about confidence, deadlines and receipts.
- No market-noise posts ("BTC up", "ETH news"). Post about predictions, not prices.
- Never tag or @mention people in automated posts. Quote posts of others are made by hand.
- No bulk, repetitive or duplicate posts. Vary the wording, and keep at most a few posts a day.
- Never paste a stranger's post text into our own post. Quote-post it instead.
- Attributed quotes only when verified (the bot's `quote` command checks the page).

## What runs automatically now

| Automated (replies, only when someone tags the bot) | Manual (the owner posts) |
|---|---|
| record, fix, help, STOP, ping | the pinned intro |
| `quote`: a verified quote about bets and predictions | all own-feed posts (ON THE RECORD, HOW IT WORKS, jokes) |
| `selfpromo`: a motto and a joke | own-feed reposts until spec 002 ships |
| | RECEIPT posts from real verdicts |

## What can be automated later

| Next | Needs |
|---|---|
| RECEIPT post when a claim gets a final verdict | constitution VI amendment (today the bot only replies to mentions) and a daily cap |
| ON THE RECORD from a hand-written queue, 1 a day | the same amendment; the queue is written by the owner, never by the AI |
| Reposts from the pool, 2 a day (spec 002) | the same amendment; the pool and weights are chosen by the owner |

## Repost pool (spec 002)

Twice a day the bot picks one account by weight, takes its latest eligible post (no replies or reposts,
at most 48 h old, never posted by us before) and reposts it; 1 time in 10 it quote-posts it instead, with a verified quote or an AI joke (half and half).
Never the same account twice in a row, never the same post twice. The bot follows all pool accounts.

Score = popularity + virality + Vaticeno relevance (each 1–10, owner research 2026-10-05).
Weight = score − 15, so the top accounts come up about 5× as often as the weakest.
Chance = weight / 157 per pick; picks per month at 60 picks.

| Account | Field | Score | Weight | Chance | Picks/month |
|---|---|---:|---:|---:|---:|
| @FabrizioRomano | sport | 30 | 15 | 9.6% | ~5.7 |
| @AdamSchefter | sport | 30 | 15 | 9.6% | ~5.7 |
| platform account kept by the owner outside the repo | forecasting | 29 | 14 | 8.9% | ~5.4 |
| @NateSilver538 | statistics | 28 | 13 | 8.3% | ~5.0 |
| @Kalshi | forecasting | 27 | 12 | 7.6% | ~4.6 |
| @100trillionUSD | crypto | 27 | 12 | 7.6% | ~4.6 |
| @RaoulGMI | crypto | 25 | 10 | 6.4% | ~3.8 |
| @StatMuse | sport | 25 | 10 | 6.4% | ~3.8 |
| @OptaJoe | sport | 25 | 10 | 6.4% | ~3.8 |
| @ESPNStatsInfo | sport | 25 | 10 | 6.4% | ~3.8 |
| @OptaAnalyst | sport | 23 | 8 | 5.1% | ~3.1 |
| @OurWorldInData | statistics | 21 | 6 | 3.8% | ~2.3 |
| @gelliottmorris | statistics | 21 | 6 | 3.8% | ~2.3 |
| @metaculus | forecasting | 20 | 5 | 3.2% | ~1.9 |
| @Statsbomb | sport | 19 | 4 | 2.5% | ~1.5 |
| @ManifoldMarkets | forecasting | 19 | 4 | 2.5% | ~1.5 |
| @_1woonomic | crypto | 18 | 3 | 1.9% | ~1.1 |
| **17 accounts** | | | **157** | 100% | 60 |

Left out: `@CryptoHayes` (unavailable on X since 2026-07-07), `@saylor`, `@PeterSchiff`.
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
