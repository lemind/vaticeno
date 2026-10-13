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
from status import auth
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


PASSWORD = "a-long-enough-password"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    """The page under test, signed in, with the snapshot substituted: these cases are about what it
    reports, and the database is covered by the TypeScript side's own job-state test."""
    monkeypatch.setenv("STATUS_PASSWORD_HASH", auth.hash_password(PASSWORD))
    monkeypatch.setenv("STATUS_SECRET", "test-secret")

    def serve(state: Snapshot):
        monkeypatch.setattr(status_app, "take_snapshot", lambda: state)
        made = TestClient(status_app.app)
        made.cookies.set(auth.COOKIE, auth.issue("test-secret"))
        return made

    return serve


@pytest.fixture
def locked(monkeypatch: pytest.MonkeyPatch):
    """The same page with nobody signed in."""
    monkeypatch.setenv("STATUS_PASSWORD_HASH", auth.hash_password(PASSWORD))
    monkeypatch.setenv("STATUS_SECRET", "test-secret")
    monkeypatch.setattr(status_app, "take_snapshot", lambda: snapshot(HEALTHY))
    return TestClient(status_app.app, base_url="https://testserver", follow_redirects=False)


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


def test_the_page_and_its_json_are_both_shut_without_a_session(locked):
    page = locked.get("/")
    assert page.status_code == 303 and page.headers["location"].endswith("/login")
    # The JSON twin is the same numbers, so it is behind the same lock.
    assert locked.get("/status.json").status_code == 401


def test_the_right_password_signs_in_and_the_wrong_one_does_not(locked):
    refused = locked.post("/login", data={"password": "wrong"})
    assert refused.status_code == 303 and "bad=1" in refused.headers["location"]
    assert auth.COOKIE not in refused.cookies

    allowed = locked.post("/login", data={"password": PASSWORD})
    assert allowed.status_code == 303
    assert auth.COOKIE in allowed.cookies
    # The cookie carries its own expiry and is signed, so it cannot be forged or extended by the holder.
    assert locked.get("/", follow_redirects=False).status_code == 200


def test_no_configured_password_lets_nobody_in(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("STATUS_PASSWORD_HASH", raising=False)
    monkeypatch.delenv("STATUS_SECRET", raising=False)
    monkeypatch.setattr(status_app, "take_snapshot", lambda: snapshot(HEALTHY))
    shut = TestClient(status_app.app, follow_redirects=False)
    assert shut.get("/").status_code == 303, "a missing password is never an open door"
    assert shut.get("/status.json").status_code == 401
    # And it says so, rather than silently refusing a password that would never match.
    assert "No password is configured" in shut.get("/login").text


def test_a_tampered_or_expired_cookie_is_refused():
    secret = "test-secret"
    good = auth.issue(secret)
    assert auth.valid(good, secret)
    assert not auth.valid(good, "another-secret"), "signed with a different key"
    assert not auth.valid(good.replace(".", ".x"), secret), "signature changed"
    expires, _, signature = good.partition(".")
    assert not auth.valid(f"{int(expires) + 99999}.{signature}", secret), "expiry extended by hand"
    assert not auth.valid(auth.issue(secret, now=0), secret), "issued long ago, now expired"
    assert not auth.valid(None, secret) and not auth.valid(good, "")


def test_a_malformed_stored_hash_refuses_rather_than_admits():
    for stored in ("", "nonsense", "scrypt$only-one-part", "bcrypt$a$b", "scrypt$!!$!!"):
        assert auth.check_password("anything", stored) is False
    assert auth.check_password(PASSWORD, auth.hash_password(PASSWORD)) is True
    assert auth.check_password("Anything-Else", auth.hash_password(PASSWORD)) is False
