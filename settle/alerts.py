"""The worker's alerts to the owner, through Sentry (003 FR-022c), like Node's `alert()` in src/observe.ts.

One HTTPS post per alert with the standard library: the Sentry SDK is not a dependency of this process. Without
SENTRY_DSN an alert is a log line only, so local runs and tests never report.
"""

from __future__ import annotations

import json
import logging
import urllib.request
import uuid
from datetime import UTC, datetime
from urllib.parse import urlsplit

log = logging.getLogger("vaticeno.settle")

SEND_TIMEOUT_SECONDS = 5


class Alerts:
    """Raises each condition once when it starts, not every minute it lasts, and says again when it clears."""

    def __init__(self, dsn: str | None):
        self.endpoint, self.auth = _parse_dsn(dsn) if dsn else (None, None)
        self.active: set[str] = set()

    def update(self, network: str, conditions: dict[str, str]) -> None:
        """`conditions`: every alert that holds now, by name, with its detail. Anything absent has cleared."""
        for name, detail in conditions.items():
            if name not in self.active:
                self.raise_alert(f"settle.{name}", network, detail)
        for name in self.active - conditions.keys():
            log.info("settle.alert_cleared network=%s alert=%s", network, name)
        self.active = set(conditions)

    def raise_alert(self, event: str, network: str, detail: str) -> None:
        log.warning("%s network=%s %s", event, network, detail)
        if not self.endpoint:
            return
        body = {
            "event_id": uuid.uuid4().hex,
            "timestamp": datetime.now(UTC).isoformat(),
            "level": "warning",
            "logger": "vaticeno.settle",
            "platform": "python",
            "message": {"formatted": f"{event}: {detail}"},
            "tags": {"event": event, "network": network},
            "fingerprint": [event, network],
        }
        envelope = "\n".join([
            json.dumps({"event_id": body["event_id"]}),
            json.dumps({"type": "event"}),
            json.dumps(body),
        ]).encode()
        request = urllib.request.Request(self.endpoint, data=envelope, method="POST", headers={
            "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": self.auth})
        try:
            with urllib.request.urlopen(request, timeout=SEND_TIMEOUT_SECONDS):
                pass
        except OSError as error:
            # Never stops a settlement: the alert is in the log either way, and the status page shows the row.
            log.error("settle.alert_not_sent event=%s error=%s", event, error)


def _parse_dsn(dsn: str) -> tuple[str, str]:
    """`https://<key>@<host>/<project>` → the envelope endpoint and its auth header."""
    parts = urlsplit(dsn)
    project = parts.path.strip("/")
    if not (parts.scheme and parts.username and parts.hostname and project):
        raise ValueError("SENTRY_DSN is not a Sentry DSN")
    host = parts.hostname + (f":{parts.port}" if parts.port else "")
    return (f"{parts.scheme}://{host}/api/{project}/envelope/",
            f"Sentry sentry_version=7, sentry_key={parts.username}, sentry_client=vaticeno-settle/1")
