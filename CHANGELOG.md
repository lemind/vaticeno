# Changelog

What changed for people using Vaticeno, newest first. The version on the site's front page is the top entry.
A new feature raises the middle number, a fix the last one. One entry per pull request: the changes that matter,
then the small ones together in one line; versions deployed while it was open share its entry.

## 1.15.6 — 2026-11-21

Odds on request (1.14.0–1.15.6).

- New command: `@vaticeno odds` under a post about a match or a race. The bot replies once with each outcome's
  range across up to three bookmakers, like `2:1–9:4 (3.00–3.25)`, and nothing else. A race shows its five
  favourites and a range for the rest. Listed in help and on the front page.
- A prediction tagged in a quote post is read together with the post it quotes, so "Jake wins" is no longer
  "unclear which Jake".
- The daily repost no longer skips a day when its group has no announcement: it moves on to the next group, and
  the next, until one has an upcoming event. It reposts only events people bet on: matches, fights, races,
  elections, rate decisions. Launches and awards are gone; Saturday is the weekend's football and rugby. The search stops at the feed's
  daily budget.
- Smaller fixes: the bot no longer answers replies that only carry its handle along (Grok's answers); heavy
  favourites read right (1:16, not 1:10); a shorter "no odds" reply.

## 1.13.0 — 2026-11-19

- The owner gets an email when a scheduled job doesn't do its work — a post X refused, no event confirmed, the
  spend cap, a crash — with the reason in plain words. At most one email per job a day.
- The daily event post looks for its two sources once more before giving up on an event.

## 1.12.0 — 2026-11-19

- Once a day the account reposts a fresh verdict on a prediction by an author who agreed to be shown (for now
  @lemind and @NeonSkeld), hits and misses alike.

## 1.11.1 — 2026-11-16

- Every weekend's biggest Hong Kong race goes out on a poster: the race, day, course and early odds.
- A horse that never ran makes the prediction void, never a miss.
- The account posts an event of its own on every free day, not only Tuesday to Thursday.
- The version on the front page opens this changelog, for the code that is running.

## 1.10.0 — 2026-11-12

- Tag the account to get an answer; answers are researched before they are given.
- Better posters.

## 1.9.1 — 2026-11-12

- Follower predictions are no longer turned away as unreadable.

## 1.9.0 — 2026-11-11

- Follower predictions are read from X.
- The weekly recheck posts its corrections by itself.

## 1.8.0 — 2026-11-09

- The account's own voice: chosen reposts, event posts and a weekly record.
- Site visits are counted.

## 1.7.0 — 2026-11-06

- Commands inside a thread: self-promotion is judged by the model, help is answered.

## 1.6.0 — 2026-11-06

- Real money: wagers on Base and Arbitrum One, in USDC and USDT.

## 1.5.1 — 2026-11-02

- Follower-count predictions read the account the post names.

## 1.5.0 — 2026-10-27

- A local verifier checks verdicts, watching in shadow.

## 1.4.0 — 2026-10-22

- Wager on a price prediction from its page (testnet).

## 1.3.0 — 2026-10-20

- Stake on a price prediction, settled by the verdict (testnet).

## 1.2.1 — 2026-10-19

- Fixed wrong verdicts, and predictions refused that should have been recorded.

## 1.2.0 — 2026-10-14

- A public front page that says whether the bot is running and which version.
- The owner's status page, behind a password.

## 1.1.0 — 2026-10-13

- A page must name the event a prediction is about before it counts as evidence.

## 1.0.4 — 2026-10-12

- The verdict says what the result was, and the bot answers when asked.
- A correction shows on the pages and is never posted twice.

## 1.0.3 — 2026-10-09

- Replies only when someone actually asked.

## 1.0.2 — 2026-10-08

- The bot reads the conversation a prediction was made in.

## 1.0.1 — 2026-10-07

- The account posts by itself: reposts and the owner's own posts.

## 1.0.0 — 2026-10-05

- Predictions lock, get public pages, and are resolved on a schedule.

## 0.3.0 — 2026-09-30

- Predictions become contracts; unclear ones are asked about; resolution.

## 0.2.0 — 2026-09-30

- The database.

## 0.1.0 — 2026-09-29

- The first bot on X.
