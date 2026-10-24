"""Windowing and the runtime contract of the pinned candidate (003 T342). The smoke test checks shape, class
order and finite scores, not that a stock model answers every pair right; it skips until the model is fetched."""

from __future__ import annotations

import math

import pytest

from verifier.fetch_model import SPEC, model_path
from verifier.nli import SPECIAL_TOKENS, WINDOW_OVERLAP, windows


def test_windows_cover_every_token_and_fit_beside_the_claim():
    page, claim_len, max_tokens = list(range(2000)), 40, 512
    spans = windows(page, claim_len, max_tokens)
    covered = set()
    for start, end in spans:
        assert end - start + claim_len + SPECIAL_TOKENS <= max_tokens
        covered.update(range(start, end))
    assert covered == set(page)
    assert all(spans[i][1] - spans[i + 1][0] == WINDOW_OVERLAP for i in range(len(spans) - 1))
    assert windows(list(range(10)), claim_len, max_tokens) == [(0, 10)]
    assert windows([], claim_len, max_tokens) == []


@pytest.mark.skipif(
    not all(model_path(name).exists() for name in SPEC["files"]), reason="run python -m verifier.fetch_model"
)
def test_pinned_model_loads_and_answers_in_the_card_order():
    from verifier.nli import Verifier

    verifier = Verifier()
    assert verifier.labels == ["contradiction", "entailment", "neutral"]
    pairs = [
        ("The final score was 2-1 to City.", "City won the match."),
        ("The final score was 0-3 to Madrid.", "City won the match."),
        ("Tickets go on sale on Monday.", "City won the match."),
    ]
    scores = [verifier.score(page, claim) for page, claim in pairs]
    for score in scores:
        assert score is not None and score.windows == 1
        assert all(math.isfinite(v) and 0 <= v <= 1 for v in (score.entail, score.contradict))
    # Only the direction of the two clear pairs, which any working class order gets right.
    assert scores[0].entail > scores[1].entail
    assert scores[1].contradict > scores[0].contradict
