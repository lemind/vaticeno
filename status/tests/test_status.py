"""Three cases the page must get right: healthy, one dead job, and no database (003 T317).

The page is not exhaustively tested — that is reserved for the gates and the resolver (003 FR-021,
~55% coverage is a cap). Fixtures are rows, built the way the queries return them.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from status import app as status_app
from status.app import Snapshot, as_json
from status.build_info import Build
from status.progress import Progress
from status.queries import Backlog, Finding, Job, Spend

NOW = datetime.now(UTC)


def job(name: str, *, ok_seconds_ago: float | None, window: int, outcome: str | None = "ok") -> Job:
    return Job(
        job=name,
        last_ok_at=None if ok_seconds_ago is None else NOW - timedelta(seconds=ok_seconds_ago),
        last_finished_at=None if ok_seconds_ago is None else NOW - timedelta(seconds=ok_seconds_ago),
        last_outcome=outcome,
        last_error_tag=None if outcome != "failed" else "SourceUnavailable",
        last_locked_at=None,
        consecutive_failures=0 if outcome != "failed" else 2,
        stale_after_seconds=window,
    )


def snapshot(jobs: list[Job], *, db_error: str | None = None, findings: list[Finding] | None = None) -> Snapshot:
    return Snapshot(
        at=NOW,
        build=Build(
            commit="f35eea9a6a03b26e7a51a19c499cb34e561c1d5c",
            deployed_at=NOW - timedelta(hours=2),
            node="v22.22.1",
        ),
        progress=Progress(
            sections={"stage": ["Stage 1"], "now": ["the status page"]},
            changed_at=NOW - timedelta(days=1),
        ),
        jobs=jobs,
        claims={"resolved": 17, "locked": 2},
        verdicts={"hit": 4, "miss": 13},
        spend=Spend(claims=17, mean_usd=0.0662, worst_usd=0.0843, over_budget=0),
        feed={"dry_run": 2},
        backlog=Backlog(waiting=0, oldest_at=None),
        findings=findings or [],
        db_error=db_error,
    )


HEALTHY = [job("lock", ok_seconds_ago=30, window=180), job("resolve", ok_seconds_ago=600, window=7260)]


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    """The page under test, with the snapshot substituted: these cases are about what it reports, and
    the database is covered by the TypeScript side's own job-state test."""

    def serve(state: Snapshot):
        monkeypatch.setattr(status_app, "take_snapshot", lambda: state)
        return TestClient(status_app.app)

    return serve


def test_a_healthy_service_answers_ok_in_its_first_line(client):
    page = client(snapshot(HEALTHY)).get("/")
    assert page.status_code == 200
    # SC-001: the state is the first thing on the page, before any detail.
    assert "OK" in page.text.split("</h1>")[0]
    assert "all 2 jobs inside their own windows" in page.text
    assert "f35eea9" in page.text, "the page says what is deployed"


def test_one_job_past_its_own_window_is_named_and_the_page_is_not_ok(client):
    # 600s since the last success against a 180s window: late. The hourly job beside it is not (SC-002).
    late = [job("lock", ok_seconds_ago=600, window=180), job("resolve", ok_seconds_ago=600, window=7260)]
    state = snapshot(late)
    assert state.state == "DEGRADED"
    assert [j.job for j in state.late_jobs] == ["lock"]
    page = client(state).get("/")
    assert "lock (STALE)" in page.text, "the page names which job, not just that something is wrong"
    assert "DEGRADED" in page.text


def test_a_job_that_never_ran_reads_as_never_run_rather_than_late(client):
    state = snapshot([job("recheck", ok_seconds_ago=None, window=1_209_660, outcome=None)])
    assert state.jobs[0].state == "NEVER_RUN"
    assert "never" in client(state).get("/").text


def test_a_failing_job_shows_its_error_tag(client):
    state = snapshot([job("resolve", ok_seconds_ago=60, window=7260, outcome="failed")])
    assert state.jobs[0].state == "FAILING"
    page = client(state).get("/")
    assert "SourceUnavailable" in page.text and "×2" in page.text


def test_the_page_renders_when_the_database_is_down(client):
    state = snapshot([], db_error='connection to server at "db" failed')
    assert state.state == "NO DATABASE"
    page = client(state).get("/")
    assert page.status_code == 200, "it reports, rather than returning a stack trace or a blank page"
    assert "database unreachable" in page.text
    # The files are read either way, so the page still says what is deployed and what the plan is.
    assert "f35eea9" in page.text and "the status page" in page.text


def test_verdicts_known_wrong_are_listed_until_corrected(client):
    finding = Finding(
        slug="s3wt9", published_outcome="miss", recheck_outcome="hit", kind="differs",
        found_at=NOW - timedelta(days=9),
    )
    page = client(snapshot(HEALTHY, findings=[finding])).get("/")
    # They outlive the recheck's seven-day window, which is why they are recorded (FR-007a).
    assert "s3wt9" in page.text and "miss → hit" in page.text and "9 d" in page.text


def test_the_json_twin_carries_the_same_numbers(client):
    state = snapshot([job("lock", ok_seconds_ago=600, window=180)])
    body = client(state).get("/status.json").json()
    assert body["state"] == "DEGRADED"
    assert body["late_jobs"] == ["lock"]
    assert body["jobs"][0]["state"] == "STALE"
    assert body["claims"] == {"resolved": 17, "locked": 2}
    assert body["spend"]["ceiling_usd"] == 0.30
    assert body["build"]["short_commit"] == "f35eea9"
    # JSON must be JSON: every datetime is a string, so a script needs no parsing rules of its own.
    assert isinstance(body["at"], str) and isinstance(body["build"]["deployed_at"], str)


def test_the_snapshot_reports_a_dead_database_instead_of_raising(monkeypatch: pytest.MonkeyPatch):
    def refuse(*_args, **_kwargs):
        raise psycopg.OperationalError("connection refused\nmore detail nobody needs")

    monkeypatch.setattr(status_app.psycopg, "connect", refuse)
    monkeypatch.setenv("DATABASE_URL_RO", "postgres://status_ro@127.0.0.1:1/none")
    state = status_app.take_snapshot()
    assert state.db_error == "connection refused", "one line, never a stack trace"
    assert state.jobs == [] and state.spend is None
    assert as_json(state)["state"] == "NO DATABASE"


def test_a_missing_url_is_reported_like_any_other_database_failure(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("DATABASE_URL_RO", raising=False)
    state = status_app.take_snapshot()
    assert state.db_error and "DATABASE_URL_RO" in state.db_error
