"""The progress block: one hand-edited file, shown with its own age (003 FR-007).

The service never writes it. Deriving it from the tasks files was considered and rejected: a plan that
needs editing is more honest than a progress bar computed from checkboxes (003 Assumptions).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

PROGRESS_PATH = Path("docs/progress.md")
HEADINGS = ("stage", "done", "now", "next")


@dataclass(frozen=True)
class Progress:
    sections: dict[str, list[str]] = field(default_factory=dict)
    changed_at: datetime | None = None
    missing: bool = False

    @property
    def age_days(self) -> float | None:
        if self.changed_at is None:
            return None
        return (datetime.now(UTC) - self.changed_at).total_seconds() / 86400


def read_progress(path: Path = PROGRESS_PATH) -> Progress:
    """A stale plan is visibly stale rather than quietly wrong, so the file's own modification time is
    shown beside it."""
    try:
        text = path.read_text()
        changed_at = datetime.fromtimestamp(path.stat().st_mtime, UTC)
    except OSError:
        return Progress(missing=True)
    return Progress(sections=_sections(text), changed_at=changed_at)


def _sections(text: str) -> dict[str, list[str]]:
    """`## Stage` … `## Next`, each holding its bullet lines. Anything else in the file is ignored."""
    found: dict[str, list[str]] = {}
    current: str | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            name = stripped[3:].strip().lower()
            current = name if name in HEADINGS else None
            if current:
                found[current] = []
        elif current and stripped.startswith(("- ", "* ")):
            found[current].append(stripped[2:].strip())
        elif current and stripped and not stripped.startswith("#"):
            found[current].append(stripped)
    return found
