"""The verifier service's contract (003 T346): the key is required, the answer has the pinned shape, and a clear
pair reads the right way round. Not a quality check. Downloads the published model once (about 95 MB)."""

from __future__ import annotations

import os

import pytest

pytest.importorskip("fastapi")
os.environ["VERIFIER_KEY"] = "test-key"

from fastapi.testclient import TestClient  # noqa: E402

from verifier.serve.app import MODEL, app  # noqa: E402

client = TestClient(app)
KEY = {"X-Verifier-Key": "test-key"}


def test_a_request_without_the_key_is_refused():
    pair = {"premise": "Bitcoin closed at $91,200.", "hypothesis": "Bitcoin closed above $90,000."}
    assert client.post("/score", json=pair).status_code == 401
    assert client.post("/score", json=pair, headers={"X-Verifier-Key": "wrong"}).status_code == 401


def test_a_clear_pair_answers_with_the_pinned_model():
    answer = client.post(
        "/score",
        json={"premise": "Bitcoin closed the day at $91,200.", "hypothesis": "Bitcoin closed above $90,000."},
        headers=KEY,
    ).json()
    assert answer["model"] == MODEL and answer["windows"] == 1 and not answer["truncated"]
    assert answer["entail"] > 0.5 > answer["contradict"]


def test_a_page_past_the_window_cap_is_cut_and_says_so(monkeypatch):
    # A 40,000-character page needs about 20 windows, under the cap of 32; the cap is lowered to reach it.
    import verifier.serve.app as served

    monkeypatch.setattr(served, "MAX_WINDOWS", 2)
    page = "Prices rose sharply in the city last year while officials said little about it. " * 100
    answer = client.post("/score", json={"premise": page, "hypothesis": "Prices rose."}, headers=KEY).json()
    assert answer["truncated"] and answer["windows"] == 2


def test_health_names_the_model():
    assert client.get("/health").json() == {"model": MODEL}
