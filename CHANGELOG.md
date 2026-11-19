# Changelog

What changed for people using Vaticeno, newest first. The version on the site's front page is the top entry.
A new feature raises the middle number, a fix the last one.

## 1.15.2 — 2026-11-19

- When there are no odds, the reply just says "No odds for this one", without counting bookmakers.

## 1.15.1 — 2026-11-19

- The front page describes `odds` as the bookmakers' odds, as a range.

## 1.15.0 — 2026-11-19

- `@vaticeno odds` now shows each outcome's range across bookmakers, shortest to longest, like 2:9–2:7
  (1.22–1.29), and nothing else; heavy favourites read right (1:16, not 1:10); it looks for three bookmakers, only the main market and the latest prices.
- The bot no longer answers another bot (or anyone) whose reply only carries its handle along, in a thread
  where it was tagged before: Grok's odds answer got the help reply.

## 1.14.0 — 2026-11-19

- New command: `@vaticeno odds` under a post about a match or a race. The bot replies once with about what
  bookmakers give — the average of two or more, as 2:1 with the decimal beside it (3.00). A race shows its five
  favourites and a range for the rest.
- The help reply lists it, and so does the front page.
- A prediction tagged in a quote post is read together with the post it quotes, so "Jake wins" under a post
  that names Jake is no longer "unclear which Jake".

## 1.13.0 — 2026-11-19

- The owner gets an email when a scheduled job doesn't do its work — a post X refused, no event confirmed, the
  spend cap, a crash — with the reason in plain words. At most one email per job a day.
- The daily event post no longer gives up when the search's own links can't be opened: it looks for its two
  sources once more.

## 1.12.0 — 2026-11-19

- Once a day the account reposts a fresh verdict on a prediction by an author who agreed to be shown (for now
  @lemind and @NeonSkeld), hits and misses alike.

## 1.11.1 — 2026-11-16

- The version on the front page opens the changelog of the code that is running.

## 1.11.0 — 2026-11-16

- Every weekend's biggest Hong Kong race goes out on a poster: the race, day, course and early odds.
- A horse that never ran makes the prediction void, never a miss.
- The account posts an event of its own on every free day, not only Tuesday to Thursday.

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
