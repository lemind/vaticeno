"""One function per block the page shows (003 FR-001).

Read-only by construction: every statement here is a SELECT, run as `status_ro`, which has no other
right (003 FR-003, deploy/status-role.md). Nothing in this module writes, retries or calls out.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from psycopg import Connection
from psycopg.rows import dict_row

# The per-claim AI ceiling, mirrored from src/llm/prices.ts (CLAIM_BUDGET_USD). Shown as the line spend
# is measured against; the TypeScript side is the one that enforces it.
CLAIM_BUDGET_USD = 0.30


@dataclass(frozen=True)
class Job:
    job: str
    last_ok_at: datetime | None
    last_finished_at: datetime | None
    last_outcome: str | None
    last_error_tag: str | None
    last_locked_at: datetime | None
    consecutive_failures: int
    stale_after_seconds: int

    @property
    def age_seconds(self) -> float | None:
        """How long since this job last finished a run successfully."""
        if self.last_ok_at is None:
            return None
        return (datetime.now(UTC) - self.last_ok_at).total_seconds()

    @property
    def state(self) -> str:
        """NEVER_RUN, STALE, FAILING or OK — the job's own window decides late (003 SC-002)."""
        age = self.age_seconds
        if age is None:
            return "NEVER_RUN"
        if age > self.stale_after_seconds:
            return "STALE"
        if self.last_outcome == "failed":
            return "FAILING"
        return "OK"

    @property
    def healthy(self) -> bool:
        return self.state == "OK"


def jobs(conn: Connection) -> list[Job]:
    rows = _rows(
        conn,
        """
        select job, last_ok_at, last_finished_at, last_outcome, last_error_tag, last_locked_at,
               consecutive_failures, stale_after_seconds
        from job_state order by job
        """,
    )
    return [Job(**row) for row in rows]


def claim_counts(conn: Connection) -> dict[str, int]:
    rows = _rows(conn, "select status, count(*)::int as n from claims group by status")
    return {row["status"]: row["n"] for row in rows}


def verdict_counts(conn: Connection) -> dict[str, int]:
    rows = _rows(
        conn,
        """
        select coalesce(outcome, 'undecided') as outcome, count(*)::int as n
        from resolutions where review_status = 'final' group by 1
        """,
    )
    return {row["outcome"]: row["n"] for row in rows}


@dataclass(frozen=True)
class Spend:
    claims: int
    mean_usd: float
    worst_usd: float
    over_budget: int
    ceiling_usd: float = CLAIM_BUDGET_USD


def spend(conn: Connection) -> Spend:
    """Cost per resolved claim against the ceiling. One row per claim, so a claim with many calls
    counts once — joining the tables instead multiplies rows and inflates the total."""
    row = _rows(
        conn,
        """
        with per_claim as (
          select claim_id, sum(usd_cost) as usd from cost_events where claim_id is not null group by claim_id
        )
        select count(*)::int as claims,
               coalesce(avg(usd), 0)::float as mean_usd,
               coalesce(max(usd), 0)::float as worst_usd,
               count(*) filter (where usd > %s)::int as over_budget
        from per_claim
        """,
        (CLAIM_BUDGET_USD,),
    )[0]
    return Spend(**row)


def feed_state(conn: Connection) -> dict[str, int]:
    """Today's own-feed posts by status: `dry_run` means the picks were recorded and nothing posted."""
    rows = _rows(
        conn,
        "select status, count(*)::int as n from feed_posts where day = current_date group by status",
    )
    return {row["status"]: row["n"] for row in rows}


@dataclass(frozen=True)
class Backlog:
    waiting: int
    oldest_at: datetime | None

    @property
    def oldest_age_hours(self) -> float | None:
        if self.oldest_at is None:
            return None
        return (datetime.now(UTC) - self.oldest_at).total_seconds() / 3600


def review_backlog(conn: Connection) -> Backlog:
    """Verdicts a human must decide, with the oldest one's age (003 US1 scenario 4)."""
    row = _rows(
        conn,
        """
        select count(*)::int as waiting, min(decided_at) as oldest_at
        from resolutions where review_status = 'needs_human'
        """,
    )[0]
    return Backlog(**row)


@dataclass(frozen=True)
class Finding:
    slug: str
    published_outcome: str
    recheck_outcome: str | None
    kind: str
    found_at: datetime

    @property
    def age_days(self) -> float:
        return (datetime.now(UTC) - self.found_at).total_seconds() / 86400


def open_findings(conn: Connection) -> list[Finding]:
    """Published verdicts the recheck decides differently and nobody has corrected, oldest first.
    They outlive the recheck's seven-day window, which is the point of recording them (003 FR-007a)."""
    rows = _rows(
        conn,
        """
        select c.slug, f.published_outcome, f.recheck_outcome, f.kind, f.found_at
        from recheck_findings f join claims c on c.id = f.claim_id
        where f.cleared_at is null order by f.found_at
        """,
    )
    return [Finding(**row) for row in rows]


def _rows(conn: Connection, sql: str, params: tuple = ()) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return cur.fetchall()
