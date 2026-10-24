"""The offline set for the local verifier (003 T341, FR-019a): a manifest of links and hashes, never page text
(constitution V). Seeded claims come from the seeds runner in replay; real verdicts from the database. T342
fetches each page again and uses it only if its hash is exactly the recorded one.

    .venv/bin/python -m verifier.eval.dataset [--database-url URL] [--no-seeds]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[2]
SEEDS_DIR = ROOT / "fixtures" / "seeds" / "open"
OUT = ROOT / "verifier" / "eval" / "data" / "manifest.jsonl"

# Development, threshold choice, final score: separate claims, fixed by the claim's key (FR-019a).
SPLITS = (("development", 60), ("threshold", 20), ("final", 20))


def split_for(key: str) -> str:
    bucket = int(hashlib.sha256(key.encode()).hexdigest(), 16) % 100
    for name, share in SPLITS:
        if bucket < share:
            return name
        bucket -= share
    raise AssertionError("splits must sum to 100")


def claim_record(key: str, origin: str, contract: dict, lock_at: str | None, outcome: str, items: list[dict],
                 category: str | None = None) -> dict:
    """Only our own derived contract and the evidence's links, hashes and judge answers: no page text."""
    return {
        "key": key,
        "origin": origin,  # seed: outcome known by hand; verdict: our resolver's final outcome, corrections applied
        "split": split_for(key),
        "category": category,
        "criterion": contract["criterion"],
        "negative_condition": contract.get("negative_condition"),
        "subject": contract.get("subject"),
        "lock_at": lock_at,
        "deadline_at": contract["deadline_at"],
        "outcome": outcome,
        "items": items,
    }


def item_record(url: str, sha256: str, extractor: str, says: str, event_date: str | None) -> dict:
    # `says` is the paid judge's answer: a weak label, never the one that decides (FR-019a).
    return {"url": url, "sha256": sha256, "extractor": extractor, "judge_says": says, "event_date": event_date}


def seed_claims() -> list[dict]:
    """Runs the seeds in replay; the last run's passed items are what the verdict rested on."""
    done = subprocess.run(
        ["npx", "tsx", "--env-file-if-exists=.env", "src/cli/seeds.ts", "open", "--verbose"],
        cwd=ROOT, capture_output=True, text=True, env={**os.environ, "LLM_MODE": "replay"},
    )
    lines = [json.loads(line) for line in done.stdout.splitlines() if line.startswith("{")]
    failure = next((line for line in lines if line.get("event") == "cli.failed"), None)
    if failure or not any("seed_id" in line and "run" not in line for line in lines):
        reason = failure["msg"] if failure else done.stderr.strip()[-300:]
        raise SeedsUnavailable(reason)

    runs: dict[str, dict[str, list[dict]]] = {}
    for line in lines:
        if "run" in line and "seed_id" in line:
            runs.setdefault(line["seed_id"], {}).setdefault(line["run"], []).append(line)
    claims = []
    for path in sorted(SEEDS_DIR.glob("*.json")):
        seed = json.loads(path.read_text())
        by_run = runs.get(seed["id"], {})
        last = by_run[max(by_run)] if by_run else []
        items = [item_record(e["url"], e["sha256"], e["extractor"], e["says"], e["event_date"])
                 for e in last if e["passed"] and e["url"] and e["sha256"]]
        claims.append(claim_record(f"seed:{seed['id']}", "seed", seed["contract"], seed["lock_at"],
                                   seed["expected_outcome"], items, seed["category"]))
    return claims


class SeedsUnavailable(Exception):
    pass


VERDICTS_SQL = """
    select c.slug, c.contract, c.lock_at, r.decided_at,
           coalesce(k.to_outcome, r.outcome) as outcome
    from resolutions r
    join claims c on c.id = r.claim_id
    left join corrections k on k.claim_id = c.id
    where r.review_status = 'final' and c.resolution_method = 'model' and c.contract is not null
    order by r.decided_at
"""

# The run that decided: the last one at or before the verdict. Earlier runs may have read other pages.
ITEMS_SQL = """
    select e.url, e.content_sha256, e.says, e.event_date
    from evidences e
    where e.claim_id = (select id from claims where slug = %(slug)s)
      and e.passed and e.url is not null and e.content_sha256 is not null
      and e.run_at = (select max(run_at) from evidences
                      where claim_id = e.claim_id and run_at <= %(decided_at)s)
"""


def verdict_claims(database_url: str, extractor: str) -> list[dict]:
    with psycopg.connect(database_url, row_factory=dict_row, connect_timeout=5) as conn:
        conn.read_only = True
        claims = []
        for row in conn.execute(VERDICTS_SQL).fetchall():
            items = [
                item_record(e["url"], e["content_sha256"], extractor, e["says"],
                            e["event_date"].isoformat() if e["event_date"] else None)
                for e in conn.execute(ITEMS_SQL, {"slug": row["slug"], "decided_at": row["decided_at"]})
            ]
            claims.append(claim_record(f"verdict:{row['slug']}", "verdict", row["contract"],
                                       row["lock_at"].isoformat() if row["lock_at"] else None,
                                       row["outcome"], items))
        return claims


def extractor_version() -> str:
    """The version the resolver's extractor names (src/resolve/fetch.ts); one place, read rather than copied."""
    source = (ROOT / "src" / "resolve" / "fetch.ts").read_text()
    marker = "export const EXTRACTOR_VERSION = '"
    start = source.index(marker) + len(marker)
    return source[start:source.index("'", start)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL_EVAL"),
                        help="where the real verdicts are read, read-only (default: DATABASE_URL_EVAL)")
    parser.add_argument("--no-seeds", action="store_true")
    args = parser.parse_args()

    claims: list[dict] = []
    report: dict = {"written_at": datetime.now(UTC).isoformat(timespec="seconds"), "extractor": extractor_version()}
    if not args.no_seeds:
        try:
            claims += seed_claims()
        except SeedsUnavailable as error:
            report["seeds_skipped"] = str(error)
    if args.database_url:
        claims += verdict_claims(args.database_url, report["extractor"])
    else:
        report["verdicts_skipped"] = "no --database-url or DATABASE_URL_EVAL"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("".join(json.dumps(c, sort_keys=True, default=str) + "\n" for c in claims))
    report |= {
        "claims": len(claims),
        "items": sum(len(c["items"]) for c in claims),
        "by_origin": {o: sum(c["origin"] == o for c in claims) for o in ("seed", "verdict")},
        "by_split": {s: sum(c["split"] == s for c in claims) for s, _ in SPLITS},
        "by_outcome": {o: sum(c["outcome"] == o for c in claims) for o in sorted({c["outcome"] for c in claims})},
        "manifest": str(OUT.relative_to(ROOT)),
    }
    print(json.dumps(report, indent=1))
    return 0 if claims else 1


if __name__ == "__main__":
    sys.exit(main())
