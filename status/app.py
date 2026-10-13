"""The owner's status page: is it running, and where are we (003 US1).

Read-only and private: it binds to localhost (003 FR-004), connects as `status_ro` (FR-003), renders
server-side with no client-side JavaScript (FR-005), and answers `/status.json` with the same numbers
so a script needs no HTML parsing (FR-006).
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from status import queries
from status.build_info import Build, read_build
from status.progress import Progress, read_progress

CONNECT_TIMEOUT_SECONDS = 3

app = FastAPI(title="Vaticeno status", docs_url=None, redoc_url=None, openapi_url=None)
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


@dataclass(frozen=True)
class Snapshot:
    at: datetime
    build: Build
    progress: Progress
    jobs: list[queries.Job]
    claims: dict[str, int]
    verdicts: dict[str, int]
    spend: queries.Spend | None
    feed: dict[str, int]
    backlog: queries.Backlog | None
    findings: list[queries.Finding]
    db_error: str | None

    @property
    def late_jobs(self) -> list[queries.Job]:
        return [job for job in self.jobs if not job.healthy]

    @property
    def state(self) -> str:
        """The page's first line. A database it cannot read, or one late job, is not "ok" (SC-002)."""
        if self.db_error:
            return "NO DATABASE"
        return "OK" if not self.late_jobs else "DEGRADED"


def take_snapshot() -> Snapshot:
    """The files are read whether or not the database answers, so a dead database still leaves a page
    that names what is deployed and what the plan says (FR-005)."""
    empty = {
        "build": read_build(),
        "progress": read_progress(),
        "at": datetime.now(UTC),
    }
    try:
        with _connect() as conn:
            return Snapshot(
                **empty,
                jobs=queries.jobs(conn),
                claims=queries.claim_counts(conn),
                verdicts=queries.verdict_counts(conn),
                spend=queries.spend(conn),
                feed=queries.feed_state(conn),
                backlog=queries.review_backlog(conn),
                findings=queries.open_findings(conn),
                db_error=None,
            )
    except psycopg.Error as error:
        # Said plainly, and never a stack trace: the page's job is to report, including about itself.
        return Snapshot(
            **empty, jobs=[], claims={}, verdicts={}, spend=None, feed={}, backlog=None, findings=[],
            db_error=_reason(error),
        )


def _connect() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL_RO")
    if not url:
        raise psycopg.OperationalError("DATABASE_URL_RO is not set (deploy/status-role.md)")
    return psycopg.connect(url, connect_timeout=CONNECT_TIMEOUT_SECONDS, autocommit=True)


def _reason(error: psycopg.Error) -> str:
    first = str(error).strip().splitlines()
    return first[0] if first else error.__class__.__name__


@app.get("/", response_class=HTMLResponse)
def page(request: Request) -> HTMLResponse:
    snapshot = take_snapshot()
    return templates.TemplateResponse(request, "index.html", {"s": snapshot})


@app.get("/status.json")
def status_json() -> JSONResponse:
    return JSONResponse(as_json(take_snapshot()))


def as_json(snapshot: Snapshot) -> dict:
    """The same numbers as the page, with each job's computed state spelled out rather than left to the
    reader (FR-006)."""
    return {
        "state": snapshot.state,
        "at": snapshot.at.isoformat(),
        "db_error": snapshot.db_error,
        "build": {**_plain(asdict(snapshot.build)), "short_commit": snapshot.build.short_commit},
        "jobs": [
            {**_plain(asdict(job)), "state": job.state, "age_seconds": job.age_seconds}
            for job in snapshot.jobs
        ],
        "late_jobs": [job.job for job in snapshot.late_jobs],
        "claims": snapshot.claims,
        "verdicts": snapshot.verdicts,
        "spend": _plain(asdict(snapshot.spend)) if snapshot.spend else None,
        "feed": snapshot.feed,
        "backlog": (
            {**_plain(asdict(snapshot.backlog)), "oldest_age_hours": snapshot.backlog.oldest_age_hours}
            if snapshot.backlog
            else None
        ),
        "findings": [
            {**_plain(asdict(finding)), "age_days": finding.age_days} for finding in snapshot.findings
        ],
        "progress": {
            "sections": snapshot.progress.sections,
            "changed_at": _plain(snapshot.progress.changed_at),
            "age_days": snapshot.progress.age_days,
            "missing": snapshot.progress.missing,
        },
    }


def _plain(value: object) -> object:
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, datetime):
        return value.isoformat()
    return value
