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

## Reposts (spec 005 FR-011)

Once a day (09:23 UTC) one X search covers the weekday's group of fields: the accounts that announce events in
them (organisers, insiders, promoters, fan and preview accounts), announcement words ("race week", "fight week",
"kicks off", "launch window"…), the last 48 hours and a floor of likes, 10 posts at most ($0.05). The model keeps
the upcoming events; the one with the most likes + 2 × reposts is reposted. None → the next day's group once;
still none → no repost. Never the same post twice. The list lives in `src/content/repost-groups.ts`; the owner
changes it there.

| Day (UTC) | Group | Min likes |
|---|---|---:|
| Mon | F1, MotoGP, space | 300 |
| Tue | football | 1,000 |
| Wed | combat sports (UFC, MMA, boxing) | 100 |
| Thu | NFL, NBA, MLB | 500 |
| Fri | cricket, tennis, golf, horse racing | 100 |
| Sat | game and tech launches, awards | 500 |
| Sun | central banks, economic data, earnings, crypto | 100 |

A sponsor's tag on an announcement is fine (owner, 2026-11-09: our stakes are between friends, not a rival
bookmaker); a post whose point is odds, tips or a betting offer is not. The old pool of 15 commentators (picked
by weight: Romano, Schefter, Nate Silver…) is retired: they almost never announce events.

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
