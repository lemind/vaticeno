# Tasks: Visibility, settlement and cost

**Input**: [spec.md](spec.md), [plan.md](plan.md), [data-model.md](data-model.md) — the detail lives there; a
task says what to build and where, and names the requirement that defines it.

**Tests**: exhaustive on the fast-path gate and on the contract's settle and refund branches. Three for the
status page — healthy, dead job, no database. Nothing else; ~55% coverage is a cap.

**Commits**: `feat(003-T3NN): …`, one line.

## Status

| | |
|---|---|
| Stage 1 | **done** 2026-10-20: the front page and `/status` behind its password are live; memory measured on the droplet (T323) |
| Stage 2 | contract, settlement path and the wager page live (page and `wager` command deployed 2026-10-20); end to end passed 2026-10-19 from the command line. Worker on the server since 2026-10-21 (T375). Open: the browser run (T373), wallet links. Testnet only, no real value, no fee, price-feed claims only (FR-031h) |
| Escrow v1 | T326a answers FR-031f before anything is deployed |
| Stage 3 | T341–T342 done 2026-10-22; shadow paused (memory, T346); the practice model (T343–T344a) next |
| `docs/decisions/` | 001 second runtime (done); 002 escrow v1 is T326a |

## Format: `[ID] [P?] [Story] Description`

[P] parallelisable · US1 status page · US2 capacity · US4 settlement and wallet links · US5 wager page · US3 verifier

---

# Stage 1

## Phase 1: Setup

- [x] T301 Constitution VII amended 2.6.0 → 2.7.0 (owner decision 2026-10-09), with the boundary and the undo condition in `docs/decisions/001-second-runtime.md`. **Stage 1 is unblocked.**
- [x] T302 [P] Get owner approval for the new dependencies in plan.md → Technical Context. All seven approved 2026-10-13.
- [x] T303 [P] Root `pyproject.toml` (3.12, ruff, pytest) with `status` and `load` groups, plus the new `.gitignore` entries. Nothing installs as a package; an install brings in dependencies only.
- [x] T304 [P] Python job in `.github/workflows/test.yml`: `ruff check .`, `pytest status load` (FR-021). Its own job, no database.

## Phase 2: Foundational

- [x] T305 Migration `drizzle/0017_job_state.sql` + `src/db/schema.ts` per data-model.md; apply locally, then Supabase. **Local only — Supabase pending.** It also creates `status_ro` without a login.
- [x] T306 `runJob` in `src/jobs/scheduler.ts` writes `job_state`; a lock skip writes `last_locked_at` only (FR-001, FR-020). Started is written inside the lock, so a skipped run never claims to have started.
- [x] T307 `stale_after_seconds` beside `SCHEDULES`, overwritten on startup, one row seeded per job. `SCHEDULES` is the only job list (FR-001, SC-002). The interval is declared, not parsed from cron: `23 9,18 * * *` has a fifteen-hour gap, not twelve.
- [x] T308 `deploy/deploy.sh` writes `.build-info.json` on the server: commit, deploy time, node version (FR-002). The node version is read on the server; rsync no longer deletes the file.
- [x] T309 `deploy/status-role.md` for the `status_ro` role, migration `drizzle/0019_status_policies.sql`, `DATABASE_URL_RO` in `.env.example` (FR-003). **Local only — Supabase pending**; the password is set by hand.
- [x] T310 [P] Test `tests/integration/job-state.test.ts`: success, failure, lock skip, never-run. Five tests. The new foreign key also meant `truncateAll` had to name the table.
- [x] T310a Migration `drizzle/0018_recheck_findings.sql` + `src/db/schema.ts` per data-model.md: `recheckRecent` records each verdict it decides differently and clears the ones a correction answered (FR-007a). **Local only — Supabase pending.**

**Checkpoint**: met. Every job in `SCHEDULES` reports state, proved against a real database; the deploy writes the build file, whose line was checked locally and lands on the next deploy.

## Phase 3: US1 — the status page (P1) 🎯 MVP

**Independent test**: stop one job, or kill the database, and the page names what is broken.

- [x] T311 [US1] `status/queries.py`: one function per block the page shows (FR-001). Every statement is a SELECT; spend sums per claim in a CTE, because joining the tables inflates it.
- [x] T312 [US1] `status/build_info.py`, `status/progress.py`: read the build and progress files, tolerate both missing (FR-002, FR-007). A missing build file is reported as missing, not guessed at.
- [x] T313 [US1] `status/app.py`: FastAPI on `127.0.0.1`, routes `/` and `/status.json`, renders with the database down (FR-005, FR-006). The files are read even when the database is not; the error is one line, never a stack trace.
- [x] T314 [US1] `status/templates/`: one screen at 1280px, overall state first, progress last (SC-001). One template, no JavaScript. Laid out for one screen, not measured in a browser.
- [x] T315 [US1] `docs/progress.md`: stage / done / now / next, seeded with where the project stands. Only those four headings are read, and the file's own modification time is shown.
- [x] T316 [P] [US1] `deploy/vaticeno-status.service` + its install line; never in `deploy/Caddyfile` (FR-004). Localhost only, read-only paths, its own virtualenv built on the server.
- [x] T316a [US1] Status page block: verdicts the recheck decides differently and nobody has corrected, oldest first, with what was published beside what the rules reach now (FR-007a). Each with its age.
- [x] T317 [US1] `status/tests/test_status.py`: healthy, stale job, database down. Fixtures are rows. Nine tests. Writing them caught `httpx` missing from the declared dependencies.
- [x] T318 [P] [US1] `README.md`: the status page and its tunnel command, plus how to run and test it locally

**Checkpoint**: the page runs and was read end to end against the real database as `status_ro` — both routes, every block. It is not yet deployed: that needs the Supabase migrations and the role's password. Use it for a week before Phase 4.

## Phase 4: US2 — the capacity baseline (P1)

**Independent test**: a load run produces a table that can be re-run after a change.

- [x] T319 [US2] `load/guard.py`: refuse a non-local target or any real credential (FR-008). It also refuses a production database string and a paid model mode. Thirteen tests.
- [x] T320 [US2] `load/locustfile.py`: the public pages and `/healthz`, ramped until p95 degrades (FR-009). p95 under 20 ms to ~320 req/s, saturating at ~430, no errors at any level.
- [x] T321 [US2] ~~`load/burst.py`~~ **`tests/load/mention-burst.test.ts`**: stubbed X reader, ten times the live mention rate, one reply each (FR-010, SC-004). TypeScript, not Python: the mention path and its stubs are. 170 drain in ~1 s, one reply each; runs in CI.
- [x] T322 [US2] Measure the connection ceiling past the pool: queue, clean refusal or wedge, and recovery time. Five connections under 300 concurrent, never six: it queues, and recovers in 4 ms.
- [x] T323 [US2] Measure peak RSS per process under load against the box's memory, and state the headroom (SC-008). **Done 2026-10-20, narrowed**: peaks from live traffic, since a burst against production is forbidden (FR-008): bot 147 MiB, status 60 MiB, about 128 MiB left of 458 if both peak together (`capacity.md`).
- [x] T324 [US2] `capacity.md`: every row with its number, hardware and date; laptop and droplet separately (SC-003). The droplet's rows say **not measured** rather than borrowing the laptop's.
- [x] T325 [US2] Replace the UNRECONCILED labels these runs answer, with the date (FR-011). Only SC-003's: a load run stubs everything that costs money, so it cannot answer a price.
- [x] T326 [P] [US2] `README.md`: how to run a load run locally. The page run needs a claim **and** a position row, or a quarter of the requests 404 and the numbers flatter the service

**Checkpoint (Phase 4)**: partly met. The numbers exist for this machine and are written down with their date and hardware. The droplet's headroom is **not** known: measuring it means running load against the live bot, which is the owner's call, so T323 stays open.

## Phase 4b: US1 — the front page, the lock and the version

Added after the page shipped (owner decision 2026-10-13): the status page gets a password and moves to
`/status` on the public host, and a public front page carries the short answer.

- [x] T360 [US1] `src/version.ts` reading `package.json`, bumped to **1.2.0**; the deploy writes it into the build file and both pages show it (FR-004c)
- [x] T361 [US1] `src/web/home-page.ts` + `GET /`: system state, version, prediction and verdict counts, in the existing public layout. Nothing operational, held by a test that greps the page for spend and job names (FR-004b)
- [x] T362 [US1] `status/auth.py`: one password, scrypt-hashed, and a signed cookie carrying its own expiry. Standard library only; the form body is parsed directly rather than pulling in a dependency (FR-004a)
- [x] T363 [US1] Login and sign-out in `status/app.py` + `status/templates/login.html`; the JSON twin is behind the same lock, and no configured password refuses everyone (FR-004)
- [x] T364 [US1] `deploy/Caddyfile` routes `/status` to the page and everything else to the public server; `STATUS_PREFIX` puts the prefix back into links and the cookie (FR-004)
- [x] T365 [US1] Generate the password on the server and append `STATUS_PASSWORD_HASH` / `STATUS_SECRET` to `.env.status`. **Owner's**: `python -m status.hash_password` prompts for it, so it reaches no shell history **Done**: both lines are in the server's `.env.status` and the service is active (checked 2026-10-20).

**Checkpoint**: the front page answers in one line and the status page asks for a password.

---

**🚀 Stage 1 deploys here.**

---

# Stage 2

## Phase 5: US4 — settlement on a testnet (P3)

**Independent test**: two addresses stake equally; the verdict pays the winner with nobody touching a wallet.
Then VOID, then the timeout refund with the worker switched off.

### Before a line of Solidity

- [x] T326a [US4] `docs/decisions/002-escrow-v1.md`: answer every item of FR-031f and FR-031h in writing first — a deployed contract gains none of it later (SC-019). **Done**: Foundry, Base Sepolia, own test ERC-20; the six numbers and the guardian key signed off 2026-10-14.
- [x] T326b [US4] Publish the settlement window and the void policy: the hours, the grounds, the reason codes, and that a complaint alone pauses nothing (FR-031b, FR-031c, FR-031e) **Done**: `docs/settlement-policy.md`, written for the people who would stake.
- [x] T326c [US4] Call it an escrow with a named referee wherever it is described — never trustless (FR-031g) **Done**: nothing in the repo called it trustless; the policy names Vaticeno, operated by n30sk, as referee.

### The contract

- [x] T327 [US4] Contract toolchain and `contracts/` skeleton; one network and one stake token, its testnet RPC and chain id in `.env.example` (FR-022, FR-036) **Done**: `contracts/` with forge-std v1.17.0 pinned as a submodule; env entries; a CI job that builds, lints with warnings denied, and tests.
- [x] T328 [US4] `contracts/src/Escrow.sol`: the seven transitions FR-031f names. `settle` starts the hold and pays nobody; the fee is fixed at deployment and zero on the testnet (FR-023, FR-024, FR-026, FR-030, FR-031b) **Done**: open, accept, expire, settle, payout, void, refund, plus a guardian pause that never blocks money owed. Every number immutable.
- [x] T328a [US4] Three refund paths — a VOID verdict, the oracle's lever inside the hold, the timeout — each return both stakes, take no fee, and are separate from `payout` (FR-031c, FR-031d) **Done**: a VOID verdict refunds at once; the void needs a reason code and an evidence reference; the timeout and the void never share a state.
- [x] T329 [US4] Contract tests on a local EVM with time advanced: every branch, a second settle or payout refused, `open` without authorization refused (SC-013, SC-014, SC-018) **Done**: 43 tests and an operator-attack invariant; 100% of lines and branches. The first invariant reached no payout at all, so it now counts what succeeds.
- [x] T330 [US4] Deploy to the testnet with the source verified publicly; record the address in `.env.example` and on the status page (FR-029) **Done 2026-10-19**: escrow `0x6281F12b…0A72`, token `0x5C2cfb7a…c2d7`, both verified (redeployed 2026-10-20 after the signature check named its numbers; the first pair, `0x19322CaA…5DD4` and `0x854B1d3a…C2F2`, is retired); every number read back from the chain matches 002-escrow-v1. The deploy cost 0.00003 ETH.

### The settlement path

- [x] T331 [US4] Migration `drizzle/0020_settlement.sql` + `src/db/schema.ts` per data-model.md: the outbox as one row per locked price claim, `settle_rw` with SELECT + UPDATE on it and SELECT on claims and resolutions; the role created by hand like `status_ro` **Done locally**: the worker's UPDATE is granted column by column, so it cannot write an outcome; a trigger freezes the outcome once set. Production waits for approval.
- [x] T331a [US4] The lock writes the outbox row for a price-feed claim in the same transaction as the lock; no other claim gets one (FR-027, FR-031a) **Done**: a model-judged claim locks with no row.
- [x] T332a [US4] A staked claim's verdict is rechecked by the TypeScript side before its outcome is set on the outbox row: the window is 72 hours and the weekly recheck does not fit in it (002-escrow-v1) **Done**: a fresh read through `rejudgeClaim`, an hour after the verdict; a disagreement holds the row, an outage leaves it open.
- [x] T332 [US4] `src/resolve/resolver.ts` sets the row's outcome when a verdict is final; an update, never an insert, and no chain call from Node (FR-027) **Done**: in `src/resolve/settlement.ts`, the one writer of an outcome, run before the resolver in the same job; a human's verdict needs no second read.
- [x] T333 [US4] `settle/worker.py`: sign each new row's open authorization; after the verdict, read the resolution, settle every matched stake `stakesOf` returns, or end `no_stake`. Own systemd unit, key readable by its own user alone (FR-025, FR-028, FR-028a) **Done**: `settle/`; it refuses a key file others can read, a chain or contract it was not built for, and an outcome the verdict does not say. Unit file written; installed by hand at deploy.
- [x] T334 [US4] Test `tests/integration/settlement-outbox.test.ts`: a model-judged claim gets no row; a claim with no stake sends nothing and ends `no_stake`; a replayed row sends nothing twice (FR-026) **Done**: 16 Node tests and 11 against a real local chain as `settle_rw`, run in CI; a replayed row sends nothing twice.
- [x] T335 [US4] Status page: outbox pending / sent / failed, the contract address, the chain, the worker's heartbeat (FR-029, FR-020a) **Done**: the queue by state with `held` and `failed` in red, the contract and chain from env; the heartbeat is a `settle` row in `job_state` the worker alone may write, and only that row.
- [x] T336 [US4] The fast path never settles: a verdict the local verifier decided alone sets no outcome on the outbox row (FR-031) **Done by construction**: only `evidence`, `arbiter` and `human` may settle; its test lands with Stage 3's decider value, which does not exist yet.
- [x] T336a [US4] Only price-feed claims can be staked — refused by the outbox, which gives no other claim a row or a signature, and by the contract. The claim pages offered no staking then; US5 adds the wager page (2026-10-19). Tested by trying both ways (FR-031a, SC-017) **Done**: no row for a model claim, no signature from the worker, and no stake without one on-chain.
- [x] T337 [US4] End to end on the testnet, scripted with `cast` and two test wallets: open, accept, deadline, verdict, payout; then VOID; then the timeout refund with the worker stopped (SC-010, SC-011, SC-012). No stake page then; US5 adds it **Passed 2026-10-19** (`scripts/e2e-testnet.sh`, escrow `0xBa1f…1f3d`): HIT paid by a third address after the window and refused inside it; VOID refunded at once; no verdict refunded at the timeout with no worker.

### The wager page (US5)

**Independent test**: a short-window testnet deployment, two browser wallets, four wagers, one per ending:
paid out after the hold (refused inside it, pressed by a third address), VOID, an expired offer returned, a
timeout refund from the page with the worker stopped (SC-020).

- [x] T366 [US5] Migration `drizzle/0021_wager_replies.sql` + `src/db/schema.ts` per data-model.md: one link and one refusal per reason per claim, RLS on with no policy (FR-038) **Done**: `wager_replies` with its unique key, CHECK and a partial index for the daily count; RLS on, no policy.
- [x] T367 [US5] `wager` as a command, routed before claim parsing; the claim found from the post's direct parent, never the conversation root; refusal reasons in FR-038's order; the row inserted before the reply, a conflict posts nothing, at most once; the daily link cap (number set later); no reply outside a claim's thread (FR-037, FR-038, constitution IV) **Done**: `src/bot/wager.ts`; one rule for "can it be wagered" in `src/wager/terms.ts`. A stranger is heard replying to the bot's reply: the existing addressing rule (FR-037).
- [x] T368 [US5] The wager reply template in `src/replies/templates.ts`: one plain-text link to our domain and the no-value line; the refusal replies without a link. The link check allows exactly this one template, and model or web text still never carries a link (FR-039, constitution VI) **Done**: model and web text are still checked for links; templates never were, so no exception was needed in code. The help reply has no room for a wager line (280 characters).
- [x] T369 [US5] Routes `/claim/<slug>` and `/claim/<slug>/wager` in `src/web/server.ts`; `/c/<slug>` redirects permanently; `contracts/http.md` of spec 001 and the slug comment follow (FR-040) **Done**: `/c/` answers 308; author pages and the HTTP contract follow.
- [x] T370 [US5] `src/web/wager-page.ts`: server-rendered contract, rule, deadline, wagering close, expiry rule, payout rule, maximum stake, the "anyone can make an offer" line, the settlement-policy link, every field escaped and data to the script as JSON; "opens shortly" until the authorization exists; the authorization served only while acceptance is open, with caching off (FR-041, FR-044, FR-046) **Done**: `src/web/wager-page.ts`, `no-store`; the deadline sent to the script is the claim's own column, the number the worker signed.
- [x] T371 [US5] `src/web/wallet.js`: reads through the public RPC with no wallet; connect, switch network; `stakesOf` then the newest 20; approve when the allowance is short, open, accept, return expired offer, payout, refund — each offered only in the state the contract allows, each shown pending, mined or failed, state re-read after every transaction; amounts BigInt; an RPC failure shown as one (FR-042, FR-043, FR-045) **Done**: `src/web/wallet.js` + `wallet-abi.js`, no library; approves exactly the stake, never unlimited. The public RPC answered 429 on a page load plus a wallet connect (2026-10-20): reads are batched, a 429 is retried, and with a wallet connected the wallet's own node reads instead (`HACK(base-sepolia-rpc)`).
- [x] T371a [US5] Test the hand-encoded calls and decoders against forge's ABI for the deployed contract and token: selectors, calldata, decoded stakes, the max-stake boundary in token units **Done**: `tests/abi/` — every selector from forge's output, `open` and the rest against `cast`; a CI step after Foundry.
- [x] T372 [US5] Test the command and the reply: a burst of `wager` on one claim posts one link; a crash between the insert and the post never posts a second; a price claim before lock refuses without using it up; a model-judged claim is told "not a price claim" even before lock; a closed claim refuses once; a post whose parent is not the claim's posts nothing (SC-021) **Done**: `tests/integration/wager.test.ts`, the page included (authorization only while open, escaping, the redirect).
- [ ] T373 [US5] End to end on a short-window testnet deployment with two browser wallets, the four wagers above, plus a pending and a reverted transaction never shown as done, and a verdict on X not yet on the chain shown as pending (SC-020, SC-022)
- [ ] T374 [US5] **Owner's, blocks nothing here**: the network for real value, Arbitrum One or Base, decided with FR-031h, and with it the token address (native USDC on that network, FR-036c) and the acceptance criteria for T376; the new contract and the end-to-end runs on that network's testnet come before any real value (FR-036a)
- [x] T375 [US4] Put the settlement worker on the server: its own user, `/etc/vaticeno-settle/` with the env file and the oracle key (mode 600), `settle_rw` given a login, the unit enabled (FR-028, FR-028a). **Done 2026-10-21**: `vaticeno-settle` active, the key and env file mode 600 under its own user, heartbeat `ok` every minute; the owner ran the key copy.
- [ ] T376 [US4] **Gated on T374, before any real value**: escrow v2 in `contracts/src/Escrow.sol` — payout, void, refund and expiry credit balances, `withdraw()` per beneficiary (FR-036b); the token fixed to the T374 address, the cap in USDC base units (FR-036c); tests in `contracts/test/` with a token that blocks one address, proving the other side still withdraws; `wallet.js` and the worker follow (withdraw action, 6 decimals)

### Linking a wallet, optional

- [ ] T338 [US4] Migration `drizzle/0022_wallet_links.sql` + `src/db/schema.ts` per data-model.md: both wallet tables, no read policy on either (FR-032)
- [ ] T339 [US4] The link flow: the page resolves the named account, issues the code, shows what is public; the post binds it; confirmation, then the private signature, through the script the wager page shares (FR-033–035c, FR-045)
- [ ] T339a [US4] `link` and `unlink` as commands, routed before claim parsing, one capped reply each, no address in it (FR-035a, FR-035d)
- [ ] T339b [US4] Before building: decide what an X compliance event does to a link (FR-035g, owner's), and approve the EVM library for signature checks (constitution VII)
- [ ] T340 [US4] Test: a link needs both halves; another account's post binds and consumes nothing; a post read twice binds once; RPC down refuses; no code in logs; revoking keeps the row; a stake works with no link (SC-015, SC-016)

**Checkpoint**: a verdict settles a contract on a testnet, the timeout refund works with nothing of ours
running, and two people can do all of it from the wager page.

**🚀 Stage 2 deploys here** — testnet only, no real value, no fee.

**Real value is not in this feature** (FR-031h): it needs a legal opinion for the operator's own country, an
independent reading of the contract, and a written incident policy.

---

# Stage 3

## Phase 6: US3 — the local verifier (P2)

**Independent test**: offline picks and freezes one candidate; shadow counts it against SC-005 (1,000 eligible confirmed claims, zero wrong), with the avoided-call share reported.

### Offline

- [x] T341 [US3] `verifier/eval/dataset.py`: a manifest, no text (FR-019a) — seeded claims (run in replay) and real verdicts: claim, window, known outcome; per passed item URL, recorded sha256, extractor version, the judge's answer as a weak label; each claim assigned to development, threshold or final. Written to gitignored `verifier/eval/data/`. `EXTRACTOR_VERSION` in `src/resolve/fetch.ts`, stamped on every item when the manifest is built — the evidences table keeps no version, so a rebuilt manifest after an extractor change would mislabel old hashes; every hash to date is v1 (`visibleText` unchanged since 2026-09-30) **Done 2026-10-22**: 23 real verdicts, 54 page items (hit 10, miss 13; splits 15/1/7). Seeds skipped (owner, 2026-10-22): the local recordings cannot replay them and a re-record is paid (001 T061); re-recorded only if T342 cannot tell the candidates apart
- [x] T342 [US3] `verifier/eval/baseline.py`: re-fetch each page in memory, admit only an exact hash match, count changed and gone ones (near matches reported apart where a simhash was recorded — none is for database evidence); stock model under one threshold rule, chosen on the threshold claims and scored once on the final ones; reports the model level (against the weak label) and the fast-path level (against the known outcome), numbers only, never page text. Adds the `verifier` dependency group **Done 2026-10-22**: `cross-encoder/nli-deberta-v3-xsmall`, `onnx/model_quint8_avx2.onnx` pinned by commit and sha256 (`verifier/model.toml`, both machines AVX2); onnxruntime + tokenizers, no torch. Only **8–9 of 54** pages still hash the same (two runs; 45 changed), and **no claim kept every page**, so no claim is fast-path eligible at any threshold: a claim missing a page is never scored, since the missing one may be the page that argues back. The offline set measures the pipe, not the model. 1.3 s a page (median). Memory: **530 MiB** with the model loaded and warm in the harness (`eval/report-baseline.json`); in a bare process 465 MiB, and 271 with graph optimisation and prepacking off (one-off measurements, settings not in code) — the droplet has about 128 free

**Checkpoint**: one report, one decision, nothing in production. The feature may stop here. A choice between candidates for shadow waits until person-confirmed claims can tell them apart (FR-019).

### Practice model (FR-019b, decision 004)

A trained model for practice and publication; it decides nothing. Runs on the laptop, published on the Hugging Face Hub.

- [ ] T343 [US3] **Licence, data and environment first** (FR-019b, decision 004): `verifier/train/data.toml` — base model, tokenizer and dataset revisions as commit IDs, licences and citations, the MultiNLI portions or filters used; the `train` group's lockfile and Python version; `training_data_license_assessment` and `weights_license` written in decision 004 (option A, B or C) — T343d blocks on both
- [ ] T343c [US3] **Before any training**: a challenge set of 50–100 original pairs, written and labelled by hand and then frozen — grouped by phenomenon (dates, negation, planned vs happened, numbers, attribution and quoted claims) with counts, no near-copies of one template; committed as `verifier/train/challenge.jsonl` (our own text, decision 004). Never used to tune; if it ever is, it is marked development and a fresh one written
- [ ] T343a [US3] Supervised baseline: `verifier/train/finetune.py` + `config.toml` — MiniLM-L6-H384 on SNLI + MultiNLI train splits, label −1 dropped and counted, max length 128 with the pair truncation recorded, batch 32 with dynamic padding, AdamW 2e-5, 5–10% warmup, 2–3 epochs with early stopping on validation, fixed seed; the first 500–1,000 steps timed before the full run; a fingerprint of each processed split. Laptop only; weights to gitignored `verifier/models/`
- [ ] T343b [US3] Export and measure: ONNX and int8 by the same pipeline as T342; `verifier/train/evaluate.py` → `train/report.md` — MNLI matched and mismatched validation, SNLI test, scored once; accuracy, macro-F1, confusion matrix, per-class precision and recall, reliability diagram, ECE, Brier, error-versus-coverage; raw and then calibrated, a temperature fitted on each artefact's own validation logits (fp32 and int8 apart) and named with its split; fp32 against int8 on every metric plus file size, latency per window and peak RSS, cold start apart; the challenge set by phenomenon, apart; an ONNX smoke test on the exported int8 file (shape, class order, finite scores); `verifier/train/reproduce.sh` runs T343a–T343b in one command, checksums of every artefact
- [ ] T343d [US3] Publish on the Hugging Face Hub, **only once T343's two licence records exist**: weights, int8 ONNX, tokenizer, model card (identity and revisions, data and licences with attribution, the weights' licence stated plainly, training setup and command, metrics by split name, calibration, memory and speed, limitations, "a research artefact, not used by Vaticeno to decide outcomes"); its commit and checksums become a second entry `verifier/model.toml` can pin
- [ ] T344 [US3] **Optional, after T343d, once T343a–b reproduce**: distillation from the stock DeBERTa-v3-xsmall teacher — same data, split and student — compared with T343a on every T343b metric
- [ ] T344a [US3] **Optional, after T343d**: a Hugging Face Space — premise and hypothesis in, three probabilities out, no URL fetching, no link to the bot, a research-demo and privacy notice

### Shadow

**Paused (owner, 2026-10-22)**: the candidate does not fit the droplet (T342) and the saving is cents a month; resumed when volume or a hosting decision changes that.

- [ ] T345 [US3] Migration `drizzle/0023_verifier.sql` + `src/db/schema.ts` per data-model.md, `outcome_confirmations` included (FR-015, FR-016, SC-005)
- [ ] T346 [US3] `verifier/serve/app.py`: one endpoint, no database, `127.0.0.1:3002`; `deploy/vaticeno-verifier.service` + its install line (FR-020). **Gated on memory**: the candidate needs 271–530 MiB (T342) against about 128 free on the droplet, so where it runs — a larger droplet, another machine, or not yet — is the owner's call before this is built
- [ ] T347 [US3] `src/resolve/verifier.ts`: one localhost call, hard timeout, Zod-parsed; any failure means no opinion and the paid path (FR-012, FR-012a)
- [ ] T348 [US3] Shadow mode in `src/resolve/resolver.ts`: ask, **ignore**, record one row per attempt, failures included. `VERIFIER_URL` and `VERIFIER_MODE` in `src/config.ts` (FR-020a)
- [ ] T349 [US3] Test `tests/integration/verifier-shadow.test.ts`: the resolution row is byte-identical, exactly one shadow row, UPDATE and DELETE rejected
- [ ] T349a [US3] The SC-005 count: a person confirms a shadow claim's outcome and names its underlying event in the existing review commands (`outcome_confirmations`, data-model); one query counts eligible claims per frozen model, one per event, and its wrong ones, shown on the status page

**Checkpoint**: shadow rows accumulate; no verdict has changed.

**🚀 Stage 3 deploys here, first of two — shadow, deciding nothing.**

### Live

**Gated on SC-005**: T350–T351 may be built and tested any time; T352 switches nothing on until the count is met.

- [ ] T350 [US3] `src/resolve/fast-path.ts`: the gate as FR-013 and FR-014 define it; anything else escalates, absence stays VOID
- [ ] T351 [US3] Test `src/resolve/fast-path.test.ts`: **exhaustive** on every gate condition, and the gate must agree with T342's harness on the same fixtures
- [ ] T352 [US3] `VERIFIER_MODE=live`: the fast path finalises and records who decided; `off` returns to today with no migration (FR-017, SC-009)
- [ ] T353 [US3] A fast-path verdict can be marked contradicted in the existing review commands (FR-018)
- [ ] T354 [US3] Verifier block on the status page: fast-path count, escalations, agreement, contradictions as incidents (FR-018)
- [ ] T355 [US3] Record the avoided-call share and per-claim spend against the baseline in `eval/report.md` (SC-006, SC-007)
- [ ] T356 [US3] Re-measure memory with all three processes live and update `capacity.md` (SC-008)

**Checkpoint**: switched on only once T349a's count meets SC-005; off and on again with no migration.

**🚀 Stage 3 deploys here, second of two — the switch on.**

---

## Phase 7: Polish

- [ ] T357 [P] `README.md`: the new services, and the Done/Next table for what shipped
- [ ] T358 [P] Mark tasks `[x]` with a one-line result; sync plan.md and data-model.md where the build diverged
- [ ] T359 Run the whole suite — node tests, integration, typecheck, ruff, pytest

---

## Dependencies

```
T301 ─ blocks all Python work
  └─ Phase 2 (T305–T310) → US1 (T311–T318) → 🚀 Stage 1
                              US2 (T319–T326) ┘
US4 contract (T327–T330) → settlement path (T331–T337) → US5 wager page (T366–T373) → links, optional (T338–T340) 🚀 Stage 2
US3 offline (T341–T342) → practice model (T343–T344a, decision 004) → shadow (T345–T349a, **paused**: memory, T346) 🚀 → live (T350–T356), switched on only when SC-005 is met 🚀
```

US1 and US2 are both P1 and independently shippable; US2 needs only Phase 2. **US3's offline evaluation runs
on a laptop** — T323's VPS measurement gates *deploying* the verifier, not evaluating it.

## Parallel opportunities

T302–T304 · T310 beside T308 and T309 · T316 and T318 once T313 exists · T326 beside the measuring tasks ·
T343c beside T343 · T357 beside T356.

## Implementation strategy

MVP is US1 alone: useful the day it ships, and what makes everything after it measurable. US2 turns estimates
into numbers. US3 may not ship at all, which is why its first checkpoint comes after two tasks (T341–T342).
