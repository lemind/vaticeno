"""T342's offline rule on the fixtures the live fast-path gate is also tested on (003 T351)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("onnxruntime")

from verifier.eval.baseline import would_finalise  # noqa: E402
from verifier.nli import PageScore  # noqa: E402

CASES = json.loads((Path(__file__).parents[1] / "eval" / "gate-fixtures.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_offline_rule_answers_as_the_fixture_says(case):
    items = [{"url": p["url"], "score": PageScore(p["entail"], p["contradict"], 1)} for p in case["pages"]]
    assert would_finalise(items, 0.9) == case["harness"]
