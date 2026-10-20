"""Load over the public pages (003 FR-009). Local targets only — see load/guard.py.

Run it headless and ramp until p95 stops being flat:

    .venv/bin/locust -f load/locustfile.py --headless -H http://localhost:3000 \\
      -u 50 -r 10 -t 60s --only-summary

The three routes the public server serves are a claim page, an author page and health (001
`contracts/http.md`). `LOAD_SLUG` and `LOAD_AUTHOR` name the rows to request; both default to a missing
row, which still exercises routing and the database round trip, and is honest about what was measured.
"""

from __future__ import annotations

import os

from locust import HttpUser, between, events, task

from load.guard import check_target

SLUG = os.environ.get("LOAD_SLUG", "none00")
AUTHOR = os.environ.get("LOAD_AUTHOR", "0")


@events.init.add_listener
def _refuse_remote_targets(environment, **_kwargs) -> None:
    """Checked once, at start, before a single request goes out (FR-008)."""
    check_target(environment.host or "")


class PublicPages(HttpUser):
    # A reader opening a page, not a scraper: the point is the service's own cost per request.
    wait_time = between(0.1, 0.5)

    @task(5)
    def claim_page(self) -> None:
        # 404 is a valid answer and still costs a query, so it is not failed here.
        self.client.get(f"/claim/{SLUG}", name="/claim/:slug", catch_response=False)

    @task(2)
    def author_page(self) -> None:
        self.client.get(f"/u/{AUTHOR}", name="/u/:id", catch_response=False)

    @task(1)
    def health(self) -> None:
        self.client.get("/healthz")
