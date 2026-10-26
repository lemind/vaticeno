"""The stock candidate over the offline manifest (003 T342, FR-019a). Plumbing and failure discovery, not a
safety claim: the labels are mostly our own resolver's, so a difference is a disagreement, not an error.

    .venv/bin/python -m verifier.eval.baseline

Pages come back through `src/cli/page-text.ts` (the resolver's own extractor) over a pipe, are used only if
their hash is exactly the recorded one, and are held in memory only, never written, until the run is scored.
The report holds numbers only.
"""

from __future__ import annotations

import json
import resource
import subprocess
import sys
import time
from datetime import UTC, datetime
from urllib.parse import urlsplit

from verifier.eval.dataset import OUT as MANIFEST
from verifier.eval.dataset import ROOT
from verifier.fetch_model import SPEC
from verifier.nli import PageScore, Verifier

REPORT = ROOT / "verifier" / "eval" / "report-baseline.json"
# Exploratory sweep (FR-019a): the lowest one with no disagreement on the threshold claims is then applied once.
THRESHOLDS = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99)


def page_answer(score: PageScore | None, threshold: float) -> str:
    """hit / miss / ambiguous / neither. A page that reaches the bar both ways decides nothing."""
    if score is None:
        return "neither"
    hit, miss = score.entail >= threshold, score.contradict >= threshold
    if hit and miss:
        return "ambiguous"
    return "hit" if hit else "miss" if miss else "neither"


def site(url: str) -> str:
    # Offline stand-in for 001's independence gate: one host is one witness. The live gate (T350) reuses 001's.
    host = urlsplit(url).hostname or url
    return host.removeprefix("www.")


def would_finalise(items: list[dict], threshold: float) -> str | None:
    """The fast-path rule (FR-013), as far as offline data allows: two sites agree, nothing argues back."""
    answers = [(page_answer(i["score"], threshold), site(i["url"])) for i in items]
    if any(a == "ambiguous" for a, _ in answers):
        return None
    for outcome, other in (("hit", "miss"), ("miss", "hit")):
        sites = {s for a, s in answers if a == outcome}
        if len(sites) >= 2 and not any(a == other for a, _ in answers):
            return outcome
    return None


def fetch_pages(urls: list[str]) -> dict[str, dict]:
    """url → {sha256, text} or {error}; text held in memory for this run only."""
    done = subprocess.run(
        ["npx", "tsx", "src/cli/page-text.ts"],
        cwd=ROOT, input="\n".join(urls) + "\n", capture_output=True, text=True, timeout=1800,
    )
    if done.returncode != 0:
        raise SystemExit(f"page-text failed with exit {done.returncode}")  # stderr may hold page bytes: not shown
    pages = {}
    for line in done.stdout.splitlines():
        answer = json.loads(line)
        pages[answer["url"]] = answer
    return pages


def sweep(claims: list[dict], split: str, threshold: float) -> dict:
    # Only claims whose every page came back exact: a dropped page may be the one that argues back (FR-013).
    chosen = [c for c in claims if c["split"] == split and c["complete"]]
    finalised = [(c, would_finalise(c["eligible"], threshold)) for c in chosen]
    decided = [(c, o) for c, o in finalised if o]
    return {
        "claims": len(chosen),
        "would_finalise": len(decided),
        "disagreements": sum(o != c["outcome"] for c, o in decided),
    }


def main() -> int:
    claims = [json.loads(line) for line in MANIFEST.read_text().splitlines()]
    urls = sorted({i["url"] for c in claims for i in c["items"]})
    verifier = Verifier()

    started = time.monotonic()
    # The model's own footprint, before any page is held: what a server would carry (T346).
    verifier.score("warm up " * 600, "a claim")
    model_rss_mib = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    pages = fetch_pages(urls)
    fetch_seconds = time.monotonic() - started

    counts = {"items": 0, "exact": 0, "changed": 0, "gone": 0, "other_extractor": 0}
    page_seconds: list[float] = []
    windows: list[tuple[int, str, str]] = []  # (windows, page answer at 0.9, judge's answer)
    for claim in claims:
        claim["eligible"] = []
        claim["complete"] = bool(claim["items"])
        for item in claim["items"]:
            counts["items"] += 1
            page = pages.get(item["url"], {})
            if "error" in page or not page:
                counts["gone"] += 1
                claim["complete"] = False
                continue
            if page["extractor"] != item["extractor"]:
                counts["other_extractor"] += 1
                claim["complete"] = False
                continue
            if page["sha256"] != item["sha256"]:
                counts["changed"] += 1
                claim["complete"] = False
                continue
            counts["exact"] += 1
            t0 = time.monotonic()
            score = verifier.score(page["text"], claim["criterion"])
            page_seconds.append(time.monotonic() - t0)
            claim["eligible"].append({"url": item["url"], "score": score, "judge": item["judge_says"]})
            if score:
                windows.append((score.windows, page_answer(score, 0.9), item["judge_says"]))
    pages.clear()  # the last reference to any page text

    # The final split is scored once, at the chosen threshold, and never shown per threshold (FR-019a).
    by_threshold = {str(t): {s: sweep(claims, s, t) for s in ("development", "threshold")} for t in THRESHOLDS}
    clean = [t for t in THRESHOLDS if by_threshold[str(t)]["threshold"]["disagreements"] == 0
             and by_threshold[str(t)]["threshold"]["would_finalise"] > 0]
    chosen = clean[0] if clean else None

    agreement: dict[str, dict[str, int]] = {}
    for _, answer, judge in windows:
        agreement.setdefault(judge, {}).setdefault(answer, 0)
        agreement[judge][answer] += 1
    buckets = {"1-5": (1, 5), "6-20": (6, 20), "21+": (21, 10**9)}
    long_pages = {
        name: {"pages": len(rows := [w for w in windows if lo <= w[0] <= hi]),
               "decided": sum(a in ("hit", "miss") for _, a, _ in rows)}
        for name, (lo, hi) in buckets.items()
    }

    report = {
        "written_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "model": {"id": SPEC["id"], "revision": SPEC["revision"], "file": next(iter(SPEC["files"]))},
        "note": "labels are the recorded outcomes, mostly our own resolver's: counts are disagreements, not errors",
        "claims": len(claims),
        "pages": counts,
        "claims_with_every_page_exact": sum(c["complete"] for c in claims),
        # The evidences table keeps no simhash, so whether a changed page differs only by a timestamp or an ad
        # cannot be told for real verdicts; replayed seeds would carry one (FR-019a).
        "near_matches": "not measurable: no recorded simhash for database evidence",
        "threshold_sweep": by_threshold,
        "threshold_chosen": chosen,
        "final_at_chosen": sweep(claims, "final", chosen) if chosen else None,
        "page_answer_vs_judge_at_0.9": agreement,
        "decided_pages_by_window_count_at_0.9": long_pages,
        "seconds": {
            "fetch_all": round(fetch_seconds, 1),
            "score_per_page_median": round(sorted(page_seconds)[len(page_seconds) // 2], 2) if page_seconds else None,
            "score_per_page_max": round(max(page_seconds), 2) if page_seconds else None,
        },
        "peak_rss_mib": {
            "model_loaded_and_warm": model_rss_mib,
            "whole_run": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),  # + every page held
        },
    }
    REPORT.write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
