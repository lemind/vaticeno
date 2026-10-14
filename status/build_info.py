"""What is running, read from the file the deploy wrote (003 FR-002). Never inferred at runtime."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

BUILD_INFO_PATH = Path(".build-info.json")


@dataclass(frozen=True)
class Build:
    commit: str | None
    deployed_at: datetime | None
    node: str | None
    version: str | None = None
    missing: bool = False

    @property
    def short_commit(self) -> str:
        return self.commit[:7] if self.commit else "unknown"

    @property
    def deployed_age_hours(self) -> float | None:
        if self.deployed_at is None:
            return None
        return (datetime.now(UTC) - self.deployed_at).total_seconds() / 3600


def read_build(path: Path = BUILD_INFO_PATH) -> Build:
    """A missing or unreadable file is reported as missing, not guessed at: the page says it does not
    know what is deployed, which is itself worth seeing."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return Build(commit=None, deployed_at=None, node=None, missing=True)
    return Build(
        commit=data.get("commit"),
        deployed_at=_parse(data.get("deployed_at")),
        node=data.get("node"),
        version=data.get("version"),
    )


def _parse(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
