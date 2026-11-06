# 008 — An account with its own voice and measurable site traffic

**Date**: 2026-11-06 · **Decided by**: the owner · **Status**: accepted (amended after review, same day) ·
**Changes**: constitution VI 2.9.0 (one exception, below), spec 002 (pool cadence, dated queue items, US4 built at
last), `docs/content-rules.md` · **Spec**: `specs/005-x-growth/spec.md` · **Relates to**: constitution IV, V, VI, VII

## The problem

The account has about 3 followers and follows about 20. What a visitor sees is sports reposts: 63 since 5 Oct,
two a day, while the owner's queue of own posts ran dry on 19 Oct after 9 posts and has posted nothing since —
with a `feed.queue_empty` alert every day that became noise and was never acted on. Nothing says what Vaticeno
is, and nothing measures whether anyone opens the site: Caddy keeps no access log at all.

## The decision

**1. Two channels, one voice.** The bot publishes only fixed, owner-approved text; judgement, links and other
people are the owner's, by hand, in the X app.

| Channel | What | Rules |
|---|---|---|
| The bot (automated, spec 002) | owner-approved originals from the queue, now on a date; the weekly deadline digest and record counts (spec 002 US4, finally built); about two pool reposts a week | constitution VI: no @mentions, links or hashtags in feed-post text; no verdict republished as a standalone post unless its author is on the list (below); the list is the only claim guard |
| The owner (by hand) | bio, pinned post, header; follows and three X Lists; quote posts of other people's predictions; replies in conversations; links to sources | X's rules; the same editorial voice (`docs/content-rules.md`) |

Every standalone post the bot makes is text the owner approved word for word, drafted with help (AI included)
before it enters the queue. The bot generates and edits nothing at run time (spec 002 FR-003 stands); the digest
and record posts are fixed templates over counts and slugs (spec 002 US4).

**2. Calls shown only with their author's permission.** The account may show a recorded prediction — terms after
the lock, verdict after the deadline — once its author has given permission, and never before. For now only the
owner has given it; how anyone else gives and takes it back is decided later. The owner records a couple of predictions a week, so the account always
has real calls to show. Each such post is written and approved by the owner once the fact exists (the lock, the
verdict), then queued; it names the claim by its slug, never @mentions the author, and reads as the author's call
recorded on Vaticeno, not Vaticeno's. Every eligible call of that author in a period is shown, misses included —
never only the hits. The rule is a list in configuration, the owner alone for now: on the list, a claim may be
shown; off it, never. Whether a claim carries money is not checked for now — the 2026-10-09 money rule is set
aside while the account grows, and revisited later. The verdict itself is still posted once in the claim's thread,
as for anyone.

**3. Originals first.** About 70% of the account's posts are its own, measured over four rolling weeks: replies
left out, native reposts counted against it, quote posts counted on their own. A target to steer by, never a
quota: three good posts beat five filler ones.

**4. A queue that does not run dry silently.** Once a week the owner reviews the next seven days: checks that each
upcoming event is still scheduled, adds originals, removes anything stale. The alert fires on Fridays when fewer than four
approved posts remain (a low-water mark), and once when the last one goes out — not every day it stays empty.

**5. Site traffic measured by Cloudflare Web Analytics.** One async script line on the public pages: page views,
visits (Cloudflare counts a visit as a page view arriving from another site or a direct link), paths, referring
hosts, countries, devices — aggregate numbers on Cloudflare's dashboard, no list of people. Free, no cookie and no
local storage, nothing stored on our server, and the site does not move to Cloudflare.

## Why Cloudflare

| Option | Why not |
|---|---|
| Caddy's access log + GoAccess on our server | the owner does not want the statistics kept on our own server |
| Google Analytics | cookies; heavier; Google keeps the data |
| Our own counter table | a migration, server code and status-page code for a counter |
| X's API for impressions | paid per read; the owner reads X's own dashboard for free |

What it costs us: it is the public pages' second browser script and the first from outside; it cannot be pinned
with subresource integrity, since Cloudflare does not version it; ad blockers and privacy browsers block it, so
traffic is undercounted. Referring hosts — t.co among them — are approximate: a browser or an in-app browser may
send none. Query strings are not recorded, so no campaign tags. No consent banner is added for it, since it sets
no cookie; the site gets a short privacy note naming Cloudflare's cookie-free, aggregate analytics, used only to
measure traffic and never joined to an X account or a prediction.

## Links

X lists **Post: Create** at $0.015 and **Content: Create with URL** at $0.20 (developer.x.com pricing, from April
2026; which category our own calls bill under is checked against our usage, not assumed). So the bot's own-feed
posts carry no URL: an Event Radar names the event and its date and stops. Its source is kept in the queue for
the owner's fact-check, never in the post. A post the owner makes by hand costs nothing and may link. This is
about own-feed posts only: replies keep their own rules (VI), including the one link to our domain in the reply
to a `wager` command.

## What it does not change

- Without its author's permission, a verdict is told once, in its claim's thread (constitution VI, owner decision
  2026-10-07).
- The account does not advertise a wager it judges. Real-money wagers are live (spec 003 Stage 4); the account says
  so plainly when asked and never posts "bet now", odds or tips (`docs/content-rules.md`).
- No follow automation, no keyword search, no unsolicited replies by the bot.
