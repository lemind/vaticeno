"""The owner's status page: is it running, and where are we (003 US1).

Read-only and private: it binds to localhost (003 FR-004), connects as `status_ro` (FR-003), renders
server-side with no client-side JavaScript (FR-005), and answers `/status.json` with the same numbers
so a script needs no HTML parsing (FR-006).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from status import auth, queries
from status.build_info import Build, read_build
from status.progress import Progress, read_progress

CONNECT_TIMEOUT_SECONDS = 3

# How many failures, within how long, before the page stops answering a guesser.
MAX_FAILURES = 5
FAILURE_WINDOW_SECONDS = 300

log = logging.getLogger("vaticeno.status")

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
    settlement: dict[str, int] = field(default_factory=dict)
    networks: list[queries.NetworkHealth] = field(default_factory=list)
    shadow: list[queries.ShadowCount] = field(default_factory=list)
    # Public addresses, not credentials: the page still holds nothing but its database connection (FR-003).
    escrow_address: str = ""
    escrow_chain_id: str = ""

    @property
    def late_jobs(self) -> list[queries.Job]:
        """Past its own window, or its last run failed. These are the ones that make the page not ok."""
        return [job for job in self.jobs if job.state in ("STALE", "FAILING")]

    @property
    def failing_networks(self) -> list[str]:
        """A network whose escrow holds less than it owes (FR-022c). A worker that stopped reading is its
        `settle-<chain id>` heartbeat going late, which already degrades the page; an unread row is only shown,
        so a network retired on purpose never holds the page down."""
        return [n.network for n in self.networks if n.underfunded]

    @property
    def waiting_jobs(self) -> list[queries.Job]:
        """Never seen to run. Every job reads like this after a deploy, and a weekly one for days, so it
        is shown but does not colour the page — otherwise a restart reads as a fault for a week."""
        return [job for job in self.jobs if job.state == "NEVER_RUN"]

    @property
    def state(self) -> str:
        """The page's first line. A database it cannot read, or one late job, is not "ok" (SC-002)."""
        if self.db_error:
            return "NO DATABASE"
        return "OK" if not (self.late_jobs or self.failing_networks) else "DEGRADED"


def take_snapshot() -> Snapshot:
    """The files are read whether or not the database answers, so a dead database still leaves a page
    that names what is deployed and what the plan says (FR-005)."""
    build = read_build()
    empty = {
        "build": build,
        "progress": read_progress(),
        "at": datetime.now(UTC),
        "version": build.version or "",
        "escrow_address": os.environ.get("ESCROW_ADDRESS", ""),
        "escrow_chain_id": os.environ.get("ESCROW_CHAIN_ID", ""),
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
                settlement=queries.settlement_queue(conn),
                networks=queries.network_health(conn),
                shadow=queries.shadow_count(conn),
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


def prefix(request: Request) -> str:
    """Caddy strips `/status` and says so in a header. Read per request, not from the environment: over
    the SSH tunnel there is no proxy and no prefix, and a fixed one sent browsers to a 404 there."""
    return (request.headers.get("x-forwarded-prefix") or "").rstrip("/")


def signed_in(request: Request) -> bool:
    """No password configured means nobody gets in, rather than everybody (status/auth.py)."""
    configured = auth.configured()
    if configured is None:
        return False
    return auth.valid(request.cookies.get(auth.COOKIE), configured[1])


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request, bad: int = 0) -> HTMLResponse:
    if signed_in(request):
        return RedirectResponse(f"{prefix(request)}/", status_code=303)
    unset = auth.configured() is None
    return templates.TemplateResponse(
        request,
        "login.html",
        {"prefix": prefix(request), "bad": bool(bad), "unset": unset},
        status_code=401 if bad else 200,
    )


# Recent failures, by client address. In memory and single-process on purpose: this is one page with one
# password, and a store would be more machinery than the thing it protects.
_failures: dict[str, list[float]] = {}


def _recent_failures(who: str, now: float) -> list[float]:
    kept = [at for at in _failures.get(who, []) if now - at < FAILURE_WINDOW_SECONDS]
    _failures[who] = kept
    return kept


@app.post("/login")
async def login(request: Request) -> Response:
    # The form body is read here rather than through `Form(...)`, which would pull in a dependency for
    # parsing one field.
    submitted = parse_qs((await request.body()).decode())
    password = (submitted.get("password") or [""])[0]
    configured = auth.configured()
    who = request.client.host if request.client else "unknown"
    now = time.time()

    if len(_recent_failures(who, now)) >= MAX_FAILURES:
        # Said out loud: the page is on the public internet, and a guesser must not be invisible.
        log.warning("status.login_blocked from=%s failures=%d", who, len(_failures[who]))
        return PlainTextResponse("too many attempts", status_code=429)

    if configured is None or not auth.check_password(password, configured[0]):
        _failures.setdefault(who, []).append(now)
        log.warning("status.login_failed from=%s failures=%d", who, len(_failures[who]))
        return RedirectResponse(f"{prefix(request)}/login?bad=1", status_code=303)

    _failures.pop(who, None)
    log.info("status.login_ok from=%s", who)
    answer = RedirectResponse(f"{prefix(request)}/", status_code=303)
    # Secure only when the request arrived over https: a browser will not send a Secure cookie back over
    # the plain-http SSH tunnel, which is how the page is read before it has a public address.
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    answer.set_cookie(
        auth.COOKIE, auth.issue(configured[1]), max_age=auth.SESSION_SECONDS,
        path="/", httponly=True, samesite="lax", secure=https,
    )
    return answer


@app.post("/logout")
def logout(request: Request) -> Response:
    answer = RedirectResponse(f"{prefix(request)}/login", status_code=303)
    answer.delete_cookie(auth.COOKIE, path="/")
    return answer


@app.get("/", response_class=HTMLResponse)
def page(request: Request) -> Response:
    if not signed_in(request):
        return RedirectResponse(f"{prefix(request)}/login", status_code=303)
    return templates.TemplateResponse(request, "index.html", {"s": take_snapshot(), "prefix": prefix(request)})


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
        "waiting_jobs": [job.job for job in snapshot.waiting_jobs],
        "claims": snapshot.claims,
        "verdicts": snapshot.verdicts,
        "spend": _plain(asdict(snapshot.spend)) if snapshot.spend else None,
        "feed": snapshot.feed,
        "settlement": snapshot.settlement,
        "networks": [
            {**_plain(asdict(n)), "underfunded": n.underfunded, "unread": n.unread(snapshot.at)}
            for n in snapshot.networks
        ],
        "failing_networks": snapshot.failing_networks,
        "shadow": [asdict(count) for count in snapshot.shadow],
        "escrow": {"address": snapshot.escrow_address, "chain_id": snapshot.escrow_chain_id},
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
