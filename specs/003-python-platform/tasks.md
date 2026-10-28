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
| Stage 2 | **done**: contract, settlement path and the wager page live (page and `wager` command deployed 2026-10-20); end to end passed 2026-10-19 from the command line, and a real browser wager (#5vpcx) settled and paid out 2026-10-26. Worker on the server since 2026-10-21 (T375). Testnet only. Wallet links optional, open |
| Escrow v1 | T326a answers FR-031f before anything is deployed |
| Stage 3 | **done** 2026-10-26: our own model in shadow on Cloud Run, the go-live count on the status page; going live parked (SC-006) |
| **Stage 4** | **real money, the goal** (owner, 2026-10-27): Phase 8 — contract v2, two networks, the FR-031h gate, mainnet |
| `docs/decisions/` | 001 second runtime (done); 002 escrow v1 is T326a |

## Format: `[ID] [P?] [Story] Description`

[P] parallelisable · US1 status page · US2 capacity · US4 settlement and wallet links · US5 wager page · US3 verifier · US6 real money

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
- [x] T374 [US5] **Owner's, blocks nothing here**: the network for real value, Arbitrum One or Base, decided with FR-031h, and with it the token address (native USDC on that network, FR-036c) and the acceptance criteria for T376; the new contract and the end-to-end runs on that network's testnet come before any real value (FR-036a) **Decided 2026-10-25 (owner): both Arbitrum One and Base**, each its own market (FR-036d); token addresses per FR-036c
- [x] T375 [US4] Put the settlement worker on the server: its own user, `/etc/vaticeno-settle/` with the env file and the oracle key (mode 600), `settle_rw` given a login, the unit enabled (FR-028, FR-028a). **Done 2026-10-21**: `vaticeno-settle` active, the key and env file mode 600 under its own user, heartbeat `ok` every minute; the owner ran the key copy.

### Linking a wallet, optional

- [ ] T338 [US4] Migration `drizzle/0024_wallet_links.sql` + `src/db/schema.ts` per data-model.md: both wallet tables, no read policy on either (FR-032)
- [ ] T339 [US4] The link flow: the page resolves the named account, issues the code, shows what is public; the post binds it; confirmation, then the private signature, through the script the wager page shares (FR-033–035c, FR-045)
- [ ] T339a [US4] `link` and `unlink` as commands, routed before claim parsing, one capped reply each, no address in it (FR-035a, FR-035d)
- [ ] T339b [US4] Before building: decide what an X compliance event does to a link (FR-035g, owner's), and approve the EVM library for signature checks (constitution VII)
- [ ] T340 [US4] Test: a link needs both halves; another account's post binds and consumes nothing; a post read twice binds once; RPC down refuses; no code in logs; revoking keeps the row; a stake works with no link (SC-015, SC-016)

**Checkpoint**: a verdict settles a contract on a testnet, the timeout refund works with nothing of ours
running, and two people can do all of it from the wager page.

**🚀 Stage 2 deploys here** — testnet only, no real value, no fee.

**Real value is Stage 4, Phase 8** (FR-022a): T373, T376 and T377 moved there on 2026-10-27.

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

- [x] T343 [US3] **Licence, data and environment first** (FR-019b, decision 004): `verifier/train/data.toml` — base model, tokenizer and dataset revisions as commit IDs, licences and citations, the MultiNLI portions or filters used; the `train` group's lockfile and Python version; `training_data_license_assessment` and `weights_license` written in decision 004 (option A, B or C) — T343d blocks on both **Done 2026-10-23**: every source pinned by commit and sha256; `requirements.lock` with hashes (torch 2.14.1+cpu, transformers 5.20.2, Python 3.12). MultiNLI's only ShareAlike text is its fiction genre, so training on the other genres (OANC, unrestricted) and keeping SNLI for evaluation lets the weights be MIT. `weights_license`: **MIT** (owner, 2026-10-23); that the crowd-written hypotheses share the OANC terms is not stated by the sources and is accepted as a documented risk
- [x] T343c [US3] **Before any training** (**frozen 2026-10-23**, sha256 in `data.toml`; 60 pairs revised after an outside review: two labels fixed, ambiguous wording pinned, every group 4 entailment / 4 contradiction / 4 neutral. Reported as a diagnostic, not a sample of real claims: one pair moves a group by 8 points. A page-level set — long text, corrections, wrong entity, partial outcomes, hedges — is a later, separate set): a challenge set of 50–100 original pairs, written and labelled by hand and then frozen — grouped by phenomenon (dates, negation, planned vs happened, numbers, attribution and quoted claims) with counts, no near-copies of one template; committed as `verifier/train/challenge.jsonl` (our own text, decision 004). Never used to tune; if it ever is, it is marked development and a fresh one written
- [x] T343a [US3] Supervised baseline: `verifier/train/finetune.py` + `config.toml` — MiniLM-L6-H384 on the data `data.toml` names — MultiNLI train with fiction dropped by its `genre` field and **asserted absent** (one test), label −1 dropped and counted, 10,000 pairs carved off by seed as the development split for checkpoint, early stopping and temperature; max length 128 with the pair truncation recorded, batch 32 with dynamic padding, AdamW 2e-5, 5–10% warmup, 2–3 epochs with early stopping on validation, fixed seed; the first 500–1,000 steps timed before the full run; a fingerprint of each processed split. Laptop only; weights to gitignored `verifier/models/` **Done 2026-10-23**: 305,354 training pairs (fiction 77,348 dropped, asserted), 3 epochs, 44 minutes on a Colab T4 — the laptop CPU measured 2.2 s a step, about 17 hours, so training ran on a free GPU with Colab's torch 2.11 (recorded in `run.json`); development accuracy 69.9% → 79.5%
- [x] T343b [US3] Export and measure: ONNX and int8 by the same pipeline as T342; `verifier/train/evaluate.py` → `train/report.md` — MNLI matched (whole, and its fiction and non-fiction parts apart) and mismatched validation, SNLI test — scored once, after every choice is made; accuracy, macro-F1, confusion matrix, per-class precision and recall, reliability diagram, ECE, Brier, error-versus-coverage; raw and then calibrated, a temperature fitted on each artefact's own development-split logits (fp32 and int8 apart) and named with its split; fp32 against int8 on every metric plus file size, latency per window and peak RSS, cold start apart; the challenge set by phenomenon, apart; an ONNX smoke test on the exported int8 file (shape, class order, finite scores); `verifier/train/reproduce.sh` runs T343a–T343b in one command, checksums of every artefact **Done 2026-10-23** (`train/report.md`): fp32 / int8 — MNLI matched 79.6 / 79.1% (fiction, untrained, 77.1 / 76.0), mismatched 80.6 / 80.3%, SNLI test 71.8 / 70.7%; temperature 1.25 / 1.23 cuts ECE about threefold; error among the 25% most confident 2.4% on mismatched, 7.2% on SNLI; challenge 39/60 and 35/60, int8 losing three on numbers. int8 file 22 MiB, peak 161 MiB in a bare process (fp32 305) — the stock candidate needed 271–530
- [x] T343d [US3] Publish on the Hugging Face Hub (licence settled in T343): weights, int8 ONNX, tokenizer, model card (identity and revisions, data and licences with attribution, each licence scope apart as decision 004 lists them, no dataset pair reproduced, training setup and command, metrics by split name, calibration, memory and speed, limitations, "a research artefact, not used by Vaticeno to decide outcomes"); its commit and checksums become a second entry `verifier/model.toml` can pin **Done 2026-10-25**: the DeBERTa winner, public at `Leminds/deberta-v3-xsmall-nli-oanc`, commit `5f0820a36d64a87c4a4cceb8574ac28db79ab30a`; weights and int8 checksums on the Hub match the card, and a load from the Hub reproduces the card's example. Card and LICENSE in `verifier/train/model-card/`
- [x] T343e [US3] A second student, **DeBERTa-v3-xsmall** (owner, 2026-10-23): the untrained MIT base, the same clean data, split and evaluation; its authors' learning rate 4.5e-5, fp16 on the GPU; `finetune --base deberta`, `evaluate --deberta`. The published model is whichever wins on the development split **Done 2026-10-24, the winner** (`train/report-deberta.md`): development 87.3% (MiniLM 79.5%), 68 minutes on a T4; fp32 / int8 — MNLI matched 87.7 / 87.1% (fiction, untrained, 86.6 / 85.8), mismatched 88.0 / 87.4%, SNLI test 82.8 / 82.4%, within half a point of its authors' 88.1 / 88.3% on all of MultiNLI; error among the 25% most confident 1.3% (mismatched); challenge 49/60 and 46/60. int8 83 MiB, peak 320 MiB, 90 ms a 128-token pair
- [x] T344 [US3] **Done 2026-10-23, before T343d (owner)**: distillation from the stock DeBERTa-v3-xsmall teacher — same data, split and student — compared with T343a on every T343b metric **Result** (`train/report-distilled.md`): development 79.9% against 79.5%, MNLI a tie (matched 79.8 / mismatched 80.6% fp32), SNLI +0.3 fp32 and +1.3 int8 — the teacher saw SNLI; 82 minutes on a T4. Not worth its licence caveat: the plain model stays the candidate
- [ ] T344a [US3] **Optional, after T343d**: a Hugging Face Space — premise and hypothesis in, three probabilities out, no URL fetching, no link to the bot, a research-demo and privacy notice

### Shadow

**Paused (owner, 2026-10-22)**: the candidate does not fit the droplet (T342) and the saving is cents a month. **Resumed 2026-10-25 (owner)**: the published model runs on our own private Cloud Run service (decision 005; free Docker Spaces now need HF PRO), so the droplet's memory no longer matters.

- [x] T345 [US3] Migration `drizzle/0022_verifier.sql` + `src/db/schema.ts` per data-model.md, `outcome_confirmations` included (FR-015, FR-016, SC-005) **Done 2026-10-25**: applied to the live database (owner); both tables, the insert-only trigger and the two empty `resolutions` columns checked there
- [x] T346 [US3] `verifier/serve/`: a FastAPI app with one key-guarded endpoint, no database, nothing logged from a request body, and a Dockerfile that fetches the published int8 model by commit and sha256; deployed as the private Cloud Run service `vaticeno-verifier` (FR-020, decision 005; replaces the localhost systemd unit) **Done 2026-10-25**: us-central1, 1 GiB, scales to zero, one instance at most, IAM-only plus the key; health, both refusals and a scored pair checked live (0.87 entail, 45 ms warm), a $1 budget alert
- [x] T347 [US3] `src/resolve/verifier.ts`: one HTTPS call to the service with a Google identity token (a run.invoker service account) and the key, hard timeout, Zod-parsed; any failure means no opinion and the paid path (FR-012, FR-012a) **Done 2026-10-25**: never throws, failures tagged timeout/network/auth/http/malformed; the identity token is minted from the `vaticeno-bot` key with node:crypto, no new dependency; config added here, `VERIFIER_MODE` off by default; live: cold 7.6 s, warm 0.36 s, a wrong key → auth
- [x] T348 [US3] Shadow mode in `src/resolve/resolver.ts`: ask, **ignore**, record one row per attempt, failures included. `VERIFIER_MODE` from `src/config.ts` (FR-020a) **Done 2026-10-25**: `src/resolve/shadow.ts`, after the decision is written, web contracts only (a feed or a profile has no page); every passed page is read against subject + criterion; would finalise only when two or more pages all pass one side at a PROVISIONAL 0.9 (no threshold tuned yet; `min_confidence` lets a later one be re-applied), and one unread page means no finalising answer; a shadow failure is logged and never touches the verdict. On only when `VERIFIER_MODE=shadow` and pages are live; **2026-10-26**: passed pages are read one after another (the service takes one request at a time), with a 30 s timeout and a 10-minute pause after a timeout or a dropped call
- [x] T349 [US3] Test: the resolution row is byte-identical, exactly one shadow row, UPDATE and DELETE rejected **Done 2026-10-25**: in `tests/integration/resolver.test.ts` (it reuses that file's search, judge and fetch stubs), four tests: the same verdict with and without the verifier, an unreachable one leaves an error row, a price claim leaves none, the row is insert-only
- [x] T349a [US3] The SC-005 count: a person confirms a shadow claim's outcome and names its underlying event in the existing review commands (`outcome_confirmations`, data-model); one query counts eligible claims per frozen model, one per event, and its wrong ones, shown on the status page **Done 2026-10-25**: `npm run review:confirm` lists would-finalise claims nobody has checked (the verifier's answer left out, so the person checks the outcome) and records one confirmation per claim with its event; the count is `status/shadow_count.sql`, run by the status page's Verifier panel and by the resolver's integration test, so the rule lives once. The candidate is pinned in code as model + gate + gates version + extractor version and every row, failures included, is filed under it, so a change to any part restarts the count; event keys are lower-cased and their spacing collapsed

**Checkpoint**: shadow rows accumulate; no verdict has changed.

**🚀 Stage 3 deploys here, first of two — shadow, deciding nothing.**

### Live

**Gated on SC-005**: T350–T351 may be built and tested any time; T352 switches nothing on until the count is met.

**T352–T355 parked (owner, 2026-10-25)**: a live fast path would avoid no paid call. Search and the per-page judge are paid before the code gates run, and the gates need the judge's quote, date and event; the verifier may read only gated evidence (FR-012), and wherever the fast-path gate finalises, the rule table already finalises the same verdict for free. Estimated from the cost ledger at prices still UNRECONCILED (`src/llm/prices.ts`), last 30 days to 2026-10-25: search $1.84, the per-page judge $0.24, the rest X reads and posts — so replacing the judge, the only call the model could stand in for, saves at most $0.24 a month and would cost the gates their checks. Shadow mode keeps measuring; savings would need a new design, in a new spec.

- [x] T350 [US3] `src/resolve/fast-path.ts`: the gate as FR-013 and FR-014 define it; anything else escalates, absence stays VOID **Done 2026-10-25**: pure; finalises only when two or more passed pages all rest on a record, all say the same hit or miss, each has its quote, date and event positively checked and no fact against it, and the frozen model reads every one that way past 0.9 with the other side under 0.1; a primary page saying pending or entity gone holds it as it holds the rule table; ten named escalation reasons otherwise. Shadow mode now runs this same gate (`gate.v3`), so the count measures what would go live
- [x] T351 [US3] Test `src/resolve/fast-path.test.ts`: **exhaustive** on every gate condition, and the gate must agree with T342's harness on the same fixtures **Done 2026-10-25**: every escalation reason, both outcomes, the threshold edges, page order, unpassed pages; `verifier/eval/gate-fixtures.json` is read by this test and by `verifier/tests/test_gate_fixtures.py` (the harness). The live gate is the stricter: wherever it finalises, the harness reaches the same outcome
- [ ] T352 [US3] `VERIFIER_MODE=live`: the fast path finalises and records who decided; `off` returns to today with no migration (FR-017, SC-009) **Parked 2026-10-25**
- [ ] T353 [US3] A fast-path verdict can be marked contradicted in the existing review commands (FR-018) **Parked 2026-10-25**
- [ ] T354 [US3] Verifier block on the status page: fast-path count, escalations, agreement, contradictions as incidents (FR-018) **Parked 2026-10-25**
- [ ] T355 [US3] Record the avoided-call share and per-claim spend against the baseline in `eval/report.md` (SC-006, SC-007) **Parked 2026-10-25**
- [x] T356 [US3] Re-measure memory with all three processes live and update `capacity.md` (SC-008) **Done 2026-10-25**: bot 148, status 56, settlement worker 72 MiB peaks; the verifier is off the box; 196 MiB available, about 108 MiB if all three peak together, before swap (`capacity.md`)

**Checkpoint**: the gate is built and tested (T350–T351); going live is parked (T352–T355, SC-006) and, if a new design revives it, waits for T349a's count to meet SC-005.

**🚀 Stage 3 deploys here, second of two — the switch on.**

---

## Phase 7: Polish

- [x] T357 [P] `README.md`: the new services, and the Done/Next table for what shipped **Done 2026-10-26**: the verifier in Status, the Done/Next table, scripts (`review:confirm`), deploy (Cloud Run and the bot's env), capacity (three processes), the status page, layout and stack
- [x] T358 [P] Mark tasks `[x]` with a one-line result; sync plan.md and data-model.md where the build diverged **Done 2026-10-26**: plan.md (where the verifier runs, Stage 3's row, the cost claim measured false) and data-model.md (the two `resolutions` columns stay null while parked)
- [x] T359 Run the whole suite — node tests, integration, typecheck, ruff, pytest **Done 2026-10-26**: typecheck, node 185, integration 210, pytest 61, the training tests 2 in `.venv-train` (the main venv has no training stack, by design), ruff and Prettier clean


---

## Phase 8: Stage 4 — real money (US6) 🎯 the goal

**Independent test**: every path, the timeout refund included, on both v2 testnets (T373); then on each of Base
and Arbitrum One a real USDC stake opened and matched from the wager page settles from a real verdict and the
winner withdraws (SC-023). No real money is left locked to watch a timeout.

**Order**: T380 (the legal opinion) is asked for first: it may change the design and a no-go ends the stage.
T378 is drafted now and amended (T378a) once T380 answers; A and B are code and start on the draft; C needs A
and B; T381's final sign-off needs C; E needs C and D, and runs per
network: Base first, Arbitrum One on its own checklist after. Nothing reaches a mainnet before D is complete
(SC-024).

### A. Contract v2

- [x] T378 [US6] `docs/decisions/007-escrow-v2.md`, first draft: every FR-031f item answered again for real value before a line of v2 — the caps decided in FR-022a (1,000 / 10,000 / 50,000 USDC, minimum 1 USDC) in base units, the fee formula with its rounding and the exact net payout, the settlement window, the timeout, the offer lifetime, who may change each, the pinned native USDC address per network, and the mainnet oracle and guardian keys by public address, role, custody and recovery — one oracle key per network, new, never the testnet ones; **no secret in the file**; the fee 0 (FR-022a, FR-022b, SC-019) **Done 2026-10-28 (first draft)**: `docs/decisions/007-escrow-v2.md` — the caps and what they count (live stakes, not credited balances), the fee formula and rounding, the pull-withdrawal and token-pinning changes, the keys by role (one oracle per network on the server; the guardian the owner's alone, 24-hour response; a new fee-recipient wallet), and the four questions held for T378a
- [ ] T378a [US6] **After T380**: amend 007 with every design change the legal opinion requires (who may open an offer, which countries, a fee), and carry each into T376–T377 before T381's final sign-off
- [x] T376 [US6] **After T378**: escrow v2 in `contracts/src/Escrow.sol` — payout, void, refund and expiry credit balances, `withdraw()` per beneficiary (FR-036b); the token fixed to the T374 address, the cap in USDC base units (FR-036c); the per-claim and total open-exposure caps checked in `open` (FR-022a); tests in `contracts/test/` with a token that blocks the maker, the taker and the fee recipient in turn, on payout, VOID, expiry and timeout refund, each its own fixture (SC-025); an offer past the per-claim or the total cap refused (SC-026); `wallet.js` and the worker follow (withdraw action, 6 decimals, the page naming the cap reached before the wallet signs) **Contract part done 2026-10-28**: in `contracts/src/EscrowV2.sol`, not `Escrow.sol` (v1 is deployed and source-verified on Base Sepolia, so its file stays as deployed); `TestUsdc.sol` (6 decimals, a USDC-style blocklist); `test/EscrowV2.t.sol` — 59 tests (every v1 branch ported to credits and withdrawals, the caps, the minimum, the USDC pin on 8453 and 42161, a blocked maker, taker, fee recipient and escrow each in its own fixture, the fee rounded down) and 3 invariants (the escrow holds exactly what it owes; the caps count exactly the live stakes; the operator never gets a token or a credit). **Page and worker done 2026-10-28**: `ESCROW_VERSION` (1 or 2, default 1) for Node and the worker; the worker signs domain version "2" and refuses to start when the contract's domain is not its version; the page reads v2's minimum, caps, locked totals and the viewer's credit, names the cap an offer or an accept would hit before the wallet signs, shows a Withdraw button for a credit, and takes the token's symbol and decimals from the chain. Checked in headless Chrome against v2 and v1 on anvil (cap refusal shown, a 5 tUSDC credit withdrawn, v1 unchanged); worker tests on v2 (signed, settled, paid, withdrawn; the wrong version refused). The page's fixed text still says VTS on Base Sepolia: per-network wording is T377

### B. Two networks

- [x] T377 [US6] **After T376**: two networks (FR-036d) — migration `drizzle/0023_networks.sql` + `src/db/schema.ts` per data-model.md: a network column on `settlement_outbox` (one row per claim per network) and `network_health`; Node writing one outbox row per network at lock (FR-027); one authorization per network, the worker settling each network it is configured for with that network's chain ID, contract, RPC and oracle key, the wager page's network picker with each network's offers apart. Proved: an authorization signed for one network is refused on the other; a stuck transaction or a dead RPC on one never delays the other; the page never shows one network's offer while the wallet is on the other **Done 2026-10-28**: `drizzle/0023_networks.sql` (networks before the optional wallet links, now 0024): `settlement_outbox.network` with UNIQUE (claim_id, network), `network_health` (its writer is T385), heartbeats renamed `settle-<chain id>` and registered by each worker itself; `WAGER_NETWORKS` (`chainId:version:escrow:token`, `src/wager/networks.ts`, a mainnet refused in any token but native USDC), the Stage 2 variables still naming one network; a row per network at lock, one second read per claim whatever its networks; one worker process per network (`deploy/vaticeno-settle@.service`), reading and writing only its own network's rows by row id; the page's `?network=` picker, each network's own row, escrow and wording. Proved in `settle/tests/test_worker.py` on two local chains (84532, 421614): one network's authorization reverts on the other, and a dead node on one leaves the other settling; `tests/integration/wager.test.ts`: the second network's page never serves the first one's signature. **Not yet applied to production**: 0023, to be deployed with the new worker (the old one's `settle` heartbeat stops matching once 0023 renames it). The bot's wager reply still says testnet only: per-network wording before a mainnet goes on (T383)

### C. Both testnets, end to end

- [ ] T379 [US6] Deploy v2 on Base Sepolia and Arbitrum Sepolia with a test token that blocks one address; source verified on both explorers; the server's env names both (FR-036a) **Prepared 2026-10-28**: `contracts/script/DeployV2.s.sol` (testnets only, 007's numbers; `runEndToEnd` in minutes for T373) and `scripts/deploy-v2-testnet.sh <chain id>`, keys from `~/.vaticeno-keys/<chain id>/`, printing the `WAGER_NETWORKS` entry; tried on a local chain. **Open, owner**: the per-network keys and testnet ETH on both, then the run
- [ ] T373 [US6] **Moved from Phase 5 and widened to v2, 2026-10-27**: end to end on both v2 testnets, short-window, with two browser wallets: the four wagers of SC-020 (paid out, VOID, offer returned, timeout refund), a withdraw on each side, the blocked address leaving the other side free (SC-025), plus a pending and a reverted transaction never shown as done, and a verdict on X not yet on the chain shown as pending (SC-020, SC-022)

### D. The real-value gate (owner's)

- [ ] T380 [US6] **Owner, asked first**: a dated written opinion (FR-031h) on the product as built — two people on opposite sides, no fee, our oracle, the price-claim event types — for the operator's own country and every country it is reachable or promoted in: its classification (betting, financial instrument under ESMA's statement of 3 July 2026, crypto-asset service under MiCA), the licences and controls required (AML/KYC, sanctions, consumer law, tax), which user countries are allowed, whether the contract must restrict who may open an offer (anyone with an authorization can call it directly, so a page-only block may not do), whether a flat per-stake fee would change the answer (FR-022b), and a go or a no-go
- [ ] T381 [US6] **Owner**: an independent review by someone with Solidity security experience from outside the project (FR-031h, SC-013) — scope: signatures and replay across networks, every state transition, reentrancy, payout, fee and withdrawal accounting, caps, roles, pause, timeouts, token assumptions. It may start early; its **final sign-off is on the frozen release commit** after T373, naming the commit, compiler and settings, and deployment parameters. Every critical and high finding fixed and re-checked; a lower one accepted only in a dated owner decision; a material change after it is re-reviewed
- [x] T382 [US6] `docs/settlement-policy.md` for real value (FR-031h, FR-036e): a wrong verdict, a corrected source, a compromised oracle key; a suspected contract fault or abuse and when to pause new offers while every exit stays open; what the guardian can do in the payout hold, who brings it online and within how long; chain or RPC outages, reorgs, low gas, stuck transactions, USDC blocking an address or the escrow itself; how users are told, where the incident is recorded **Done 2026-10-28, draft until T378a**: the policy now covers both the testnet and real money: networks apart, credits and Withdraw, the four limits, the risks the contract cannot remove (a blocked address, a blocked or paused USDC, a halted network, a late-found mistake, a code fault), who holds which role, ten incident cases with the guardian acting within 24 hours, how people are told, and `docs/incidents/` as the public record. The wager page's own wording of FR-036e is T384

### E. Mainnet

- [ ] T383 [US6] **Per network, Base first**: deploy the T381-signed commit with the T378 keys and caps; source verified and the deployed bytecode and constructor values checked against the reviewed commit; the oracle funded with ETH for gas; that network's oracle key installed on the server beside the worker's (`/etc/vaticeno-settle/`, mode 600, its own file); the server's env names the network **with no authorization issued yet** (FR-022a, FR-036c)
- [x] T384 [US6] The page and the bot for real money: no "testnet" or "worth nothing" wording, amounts in USDC, the network shown on every stake, the network picker live (Story 6 scenario 5) **Done 2026-10-28**: the page's testnet notice, faucet line and test-token wording appear only on a testnet; on v2 it says money is credited and withdrawn, and the risks the contract cannot remove (a frozen address, a frozen or paused USDC, a halted network) beside the policy link (FR-036e); every stake and the count name their network. The bot's link names the real-money networks and USDC once any is switched on, still one link. Checked in `tests/integration/wager.test.ts`. Goes live per network with T383/T386
- [x] T385 [US6] Monitoring per network (FR-022c): the worker reads the chain and writes `network_health`; it raises a **Sentry alert** to the owner, and the status page reads the row: the oracle's gas below a low-water mark, RPC health, the settlement backlog and its oldest age, failed or stuck transactions, the last successful settlement, and the escrow's USDC balance against everything it owes — open offers, matched stakes and credited balances not yet withdrawn (Story 6 scenario 4) **Done 2026-10-28**: `settle/health.py` after every pass (never before settling): the oracle's gas, the escrow's USDC and what it owes, read from a new `creditTotal()` on v2 (owed = `lockedTotal + creditTotal`, held by the invariant suite), the backlog aged from its final verdict, the last settlement; written to `network_health`, v2 networks only (v1 has no counters). Alerts `gas_low`, `underfunded`, `backlog_old`, `stuck` (10+ failed passes) and `rpc_down`, each raised once when it starts and logged when it clears, through `settle/alerts.py` (Sentry's envelope endpoint over the standard library; no SDK added). Thresholds 0.002 ETH and 6 hours, UNRECONCILED until T373 measures the gas. The status page's Networks panel; a network short of what it owes, or unread for five minutes, degrades the page
- [ ] T386 [US6] **Per network, after T383–T385**: switch on the first authorization (a separate step from the deploy and the page, Story 6 scenario 6); then a small smoke stake from two wallets the owner controls, opened, matched, settled from a real verdict and withdrawn by both; the result written into this task. Only then is the network announced, in an owner-written post that names no claim carrying a stake (constitution VI) (SC-023)

**Checkpoint**: per network — real USDC stakes settle and are withdrawn, every alert fires on a test, and
the other network is unaffected by anything that happens on this one.

**🚀 Stage 4 deploys here — real money.**

---

## Dependencies

```
T301 ─ blocks all Python work
  └─ Phase 2 (T305–T310) → US1 (T311–T318) → 🚀 Stage 1
                              US2 (T319–T326) ┘
US4 contract (T327–T330) → settlement path (T331–T337) → US5 wager page (T366–T372) → links, optional (T338–T340) 🚀 Stage 2
US3 offline (T341–T342) → practice model (T343–T344a, decision 004) → shadow (T345–T349a, **live since 2026-10-25** on Cloud Run, decision 005) 🚀 → the fast-path gate (T350–T351) → live (T352–T355) **parked**, avoids no paid call (SC-006) → memory (T356)
US6 real money: legal opinion, asked first (T380) ──→ amend v2 decision (T378a)
                v2 draft (T378) → v2 contract (T376) → two networks (T377) → testnets (T379, T373) → review sign-off (T381)
                incident policy (T382) ──────────────────────────────────────────────────────────────────┐
                per network, Base first: deploy (T383) → page (T384) → alerts (T385) → first stake (T386) ←┘ 🚀 Stage 4
```

US1 and US2 are both P1 and independently shippable; US2 needs only Phase 2. **US3's offline evaluation runs
on a laptop** — T323's VPS measurement gates *deploying* the verifier, not evaluating it.

## Parallel opportunities

T302–T304 · T310 beside T308 and T309 · T316 and T318 once T313 exists · T326 beside the measuring tasks ·
T343c beside T343 · T357 beside T356.

## Implementation strategy

**The goal is Stage 4, real money** (owner, 2026-10-27); every stage before it makes it safe or measurable.
MVP is US1 alone: useful the day it ships, and what makes everything after it measurable. US2 turns estimates
into numbers. US3 may not ship at all, which is why its first checkpoint comes after two tasks (T341–T342).
