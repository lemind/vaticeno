# POC: mention ingestion on X (read-only)

Goal: prove that `@vaticeno record …` posted on X reaches our code and is parsed correctly.
This is INIT_SPEC Stage 1. The only live reply is `pong` to posts containing *ping*; every other command is log-only.

## 1. X side (manual, one time)

- [ ] **Create the bot account `@vaticeno`** — a separate X account, not your personal one.
      Use its own email. (Automated label + bio link to your account are required before live replies — §10 — not for this POC.)
- [ ] **Open the X Developer Console** (developer.x.com) — sign in **as the bot account**, so the app belongs to it.
- [ ] **Create a Project + App.** Pay-per-usage is the default plan for new developers.
- [ ] **Buy a small amount of credits** and **set a spending limit** for the billing cycle (§8). $5 is plenty for the POC.
- [ ] **Keys and tokens → Bearer Token** → generate and copy it. Read-only polling needs nothing else.
- [ ] **For replies:** User authentication settings → App permissions **Read and write**, type **Web App, Automated App or Bot**, callback `http://localhost:3033/callback`.
- [ ] **Posting token:** Keys and tokens → OAuth 2.0 → **Access Token → Generate** (as the bot). Save access + refresh token to `.state/x-oauth.json` as `{access_token, refresh_token, expires_at}` — or run `npm run poc:auth` for the browser flow.

## 2. Local setup

```bash
npm install
cp .env.example .env         # paste X_BEARER_TOKEN
npm run poc:whoami           # prints X_BOT_USER_ID → paste into .env
npm run poc:poll             # polls every 60s, logs one JSON line per mention
```

Ctrl-C stops after the current poll (Ctrl-C twice exits immediately).
The `since_id` cursor lives in `.state/ingest.json`; delete that file to re-read recent mentions.

## 3. Test script (post these from your personal account)

| Post | Expected `decision.outcome` |
|---|---|
| `@vaticeno record BTC daily close above $150,000 by 2026-12-31` | `record`, context `inline` |
| Post a prediction, then reply to it: `@vaticeno record` | `record`, context `parent` |
| Reply `@vaticeno record` under **someone else's** post | `rejected`, `third_party` |
| `@vaticeno record` (new post, no text) | `needs_info` |
| `@vaticeno amend BTC above $140k by 2026-12-31` | `amend` |
| `@vaticeno STOP` | `opt_out` |
| `@vaticeno hello` | `ignored`, `no_command` |

Offline check without X: `npm run poc:parse -- "@vaticeno otr ETH below 2k by 2027-01-01"`.

## 4. Open questions this POC should answer

- **Field names.** The client requests `tweet.fields`/`referenced_tweets`; the current docs page shows `post.fields`/`referenced_posts`. If X returns 400, the error body lists the accepted names — fix `src/x/client.ts`.
- **Billing category (UNRECONCILED).** Spec §9 assumes mentions bill as Owned Reads ($0.001/resource). We poll with an app-only Bearer token; confirm in the Usage endpoint / console whether that still counts as Owned Read or as a normal Post read ($0.005).
- **Latency.** How long between posting and the mention showing up in the poll.
- **Edits.** Whether `edit_controls` comes back on mentions (needed for the lock rule, §6.6).

## What is deliberately missing

No DB, no normalizer, no processing lease, no post-crash recovery pass (§6.7) — those are Stage 0/1 proper.
