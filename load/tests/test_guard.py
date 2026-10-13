"""The guard is the one part of the harness worth testing exhaustively: it is what stops a load run from
posting to X and spending real money (003 FR-008)."""

from __future__ import annotations

import pytest

from load.guard import NotLocal, check_target

CLEAN = {"LLM_MODE": "replay", "DATABASE_URL": "postgres://postgres:dev@localhost:5433/vaticeno"}


def test_a_local_target_with_a_clean_environment_is_allowed():
    assert check_target("http://localhost:3000", CLEAN) == "http://localhost:3000"
    assert check_target("http://127.0.0.1:3000", CLEAN)


@pytest.mark.parametrize(
    "url",
    [
        "http://209.38.255.111:3000",
        "https://vaticeno.example.com",
        "https://db.abcdefgh.supabase.co",
        "http://192.168.1.50:3000",
    ],
)
def test_a_remote_target_is_refused(url: str):
    with pytest.raises(NotLocal):
        check_target(url, CLEAN)


def test_a_target_that_is_not_a_url_is_refused():
    with pytest.raises(NotLocal, match="not a url"):
        check_target("localhost:3000", CLEAN)


@pytest.mark.parametrize("name", ["X_BEARER_TOKEN", "X_ACCESS_TOKEN", "GEMINI_API_KEY", "SENTRY_DSN"])
def test_a_real_credential_in_the_environment_is_refused(name: str):
    # Even against localhost: the bot wired with real tokens would post to the real account.
    with pytest.raises(NotLocal, match="real credentials"):
        check_target("http://localhost:3000", {**CLEAN, name: "set"})


def test_an_empty_credential_is_not_a_credential():
    assert check_target("http://localhost:3000", {**CLEAN, "X_BEARER_TOKEN": ""})


def test_a_production_database_is_refused_even_with_a_local_target():
    env = {**CLEAN, "DATABASE_URL": "postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"}
    with pytest.raises(NotLocal, match="production"):
        check_target("http://localhost:3000", env)


def test_a_paid_model_mode_is_refused():
    with pytest.raises(NotLocal, match="paid calls"):
        check_target("http://localhost:3000", {**CLEAN, "LLM_MODE": "live"})
    with pytest.raises(NotLocal, match="paid calls"):
        check_target("http://localhost:3000", {**CLEAN, "LLM_MODE": "record"})
