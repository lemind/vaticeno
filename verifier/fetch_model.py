"""Download the pinned candidate into gitignored `verifier/models/` (003 T342). Each file goes to a temporary
name, is checked against `model.toml`, and only then renamed into place: a bad download is never loadable.

    .venv/bin/python -m verifier.fetch_model
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import tomllib
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = tomllib.loads((HERE / "model.toml").read_text())
MODEL_DIR = HERE / "models" / SPEC["id"].replace("/", "--") / SPEC["revision"]


def model_path(name: str) -> Path:
    return MODEL_DIR / name


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(name: str, expected: str) -> None:
    target = model_path(name)
    if target.exists() and sha256_of(target) == expected:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://huggingface.co/{SPEC['id']}/resolve/{SPEC['revision']}/{name}"
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".part-")
    try:
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(url, timeout=60) as response:
            while chunk := response.read(1 << 20):
                out.write(chunk)
        actual = sha256_of(Path(tmp))
        if actual != expected:
            raise SystemExit(f"{name}: sha256 {actual} is not the pinned {expected}; nothing installed")
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main() -> int:
    for name, expected in SPEC["files"].items():
        fetch(name, expected)
        print(f"{name}: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
