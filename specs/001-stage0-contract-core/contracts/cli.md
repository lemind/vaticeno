# CLI contract (Stage 0 operator interface)

All commands: `npm run <script> -- [options]`. Output is structured JSON lines unless `--pretty`.
`LLM_MODE=live|record|replay` (default `replay`) controls model and web-fetch calls.
`--now <ISO>` overrides the clock for lifecycle commands (simulated time).

| Script | Purpose | Key options | Exit code |
|---|---|---|---|
| `corpus` | run the fixture corpus through proposal + checks (FR-006) | `--group <name>`, `--model <id>` | 0 if pass rate ≥ 90%, else 1 |
| `seeds:crypto` | resolve the 60 frozen crypto seeds | — | 0 only if 100% correct |
| `seeds:open` | resolve the seeded open-topic set with the model judge | `--model <id>` | 0 if agreement ≥ 95% and wrong HIT/MISS < 5% |
| `claim:submit` | create a claim from text as if summoned | `--text`, `--author`, `--post` | 0 |
| `claim:amend` | apply an amend | `--slug`, `--text` | 0 |
| `claim:edit` | simulate an edit of the original tweet (picked up at lock time) | `--slug`, `--text` | 0 |
| `jobs:tick` | run lock sweeper, needs-info expiry and resolver once (same service functions cron calls) | `--now` | 0 |
| `review:list` | resolutions flagged for human review, with their evidence | — | 0 |
| `resolve:manual` | human decision for a flagged (`needs_human`) resolution (FR-026); the only operator write path; refuses final ones | `--slug`, `--outcome hit\|miss\|void`, `--deciding-evidence <id>`, `--note` | 0 |
| `db:migrate` | apply migrations | — | 0 |

## Corpus report (per fixture, JSON line)

```json
{ "fixture_id": "vague-003", "group": "vague_magnitude",
  "expected": "needs_info", "actual": "needs_info", "pass": true,
  "unclear": ["deadline", "measurable_outcome"], "reply_chars": 212 }
```
Final line: `{ "total": 100, "passed": 93, "pass_rate": 0.93, "by_group": { ... } }`.

## Fixture file format (`fixtures/corpus/*.jsonl`)

```json
{ "id": "fda-001", "group": "well_formed", "today": "2026-09-28",
  "text": "FDA approves a drug for pancreatic cancer by 2030-12-31",
  "expected": "recorded",
  "expect_contract": { "resolution_method": "model", "deadline_at": "2030-12-31T23:59:59Z",
                       "source.absence_is_meaningful": true } }
```

## Seed file format (`fixtures/seeds/{crypto,open}/*.json`)

```json
{ "id": "open-017", "category": "announcement_before_lock_event_after",
  "contract": { ...ContractSchema... }, "lock_at": "2024-02-01T12:00:00Z",
  "expected_outcome": "hit", "note": "why this is the right answer" }
```
`expected_outcome` ∈ `hit | miss | void | needs_human | pending` (`pending` = claim still waiting,
e.g. a price gap that blocks a MISS).
`category` must be one of the SC-003 categories; `seeds:open` fails if any category is below its
minimum count. Crypto seeds add `"candles": [[1710028800, low, high, open, close, volume], ...]`
(frozen Coinbase daily candles).
