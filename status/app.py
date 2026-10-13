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
from urllib.parse import parse_qs

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from status import auth, queries
from status.build_info import Build, read_build
from status.progress import Progress, read_progress

CONNECT_TIMEOUT_SECONDS = 3

# Caddy serves this under /status and strips the prefix, so links and the cookie carry it back.
PREFIX = os.environ.get("STATUS_PREFIX", "").rstrip("/")

# Read from the deploy's build file, written from package.json: one source for the running version.
VERSION = os.environ.get("STATUS_VERSION", "")

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
    version: str = ""

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
    build = read_build()
    empty = {
        "build": build,
        "progress": read_progress(),
        "at": datetime.now(UTC),
        "version": build.version or VERSION,
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


def signed_in(request: Request) -> bool:
    """No password configured means nobody gets in, rather than everybody (status/auth.py)."""
    configured = auth.configured()
    if configured is None:
        return False
    return auth.valid(request.cookies.get(auth.COOKIE), configured[1])


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request, bad: int = 0) -> HTMLResponse:
    if signed_in(request):
        return RedirectResponse(f"{PREFIX}/", status_code=303)
    unset = auth.configured() is None
    return templates.TemplateResponse(
        request, "login.html", {"prefix": PREFIX, "bad": bool(bad), "unset": unset}, status_code=401 if bad else 200
    )


@app.post("/login")
async def login(request: Request) -> Response:
    # The form body is read here rather than through `Form(...)`, which would pull in a dependency for
    # parsing one field.
    submitted = parse_qs((await request.body()).decode())
    password = (submitted.get("password") or [""])[0]
    configured = auth.configured()
    if configured is None or not auth.check_password(password, configured[0]):
        return RedirectResponse(f"{PREFIX}/login?bad=1", status_code=303)
    answer = RedirectResponse(f"{PREFIX}/", status_code=303)
    # Secure only when the request arrived over https: a browser will not send a Secure cookie back over
    # the plain-http SSH tunnel, which is how the page is read before it has a public address.
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    answer.set_cookie(
        auth.COOKIE, auth.issue(configured[1]), max_age=auth.SESSION_SECONDS,
        path=PREFIX or "/", httponly=True, samesite="lax", secure=https,
    )
    return answer


@app.post("/logout")
def logout() -> Response:
    answer = RedirectResponse(f"{PREFIX}/login", status_code=303)
    answer.delete_cookie(auth.COOKIE, path=PREFIX or "/")
    return answer


@app.get("/", response_class=HTMLResponse)
def page(request: Request) -> Response:
    if not signed_in(request):
        return RedirectResponse(f"{PREFIX}/login", status_code=303)
    return templates.TemplateResponse(request, "index.html", {"s": take_snapshot(), "prefix": PREFIX})


@app.get("/status.json")
def status_json(request: Request) -> JSONResponse:
    # The machine-readable twin is the same data, so it is behind the same lock (FR-006, FR-004).
    if not signed_in(request):
        return JSONResponse({"error": "sign in"}, status_code=401)
    return JSONResponse(as_json(take_snapshot()))


def as_json(snapshot: Snapshot) -> dict:
    """The same numbers as the page, with each job's computed state spelled out rather than left to the
    reader (FR-006)."""
    return {
        "state": snapshot.state,
        "version": snapshot.version,
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
