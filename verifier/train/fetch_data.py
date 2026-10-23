"""Download everything `data.toml` pins — the base model and the datasets — checked by sha256 (003 T343a).

    .venv-train/bin/python -m verifier.train.fetch_data
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

from verifier.fetch_model import download, sha256_of

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = tomllib.loads((HERE / "data.toml").read_text())


def base_dir() -> Path:
    base = DATA["base"]
    return ROOT / "verifier" / "models" / base["id"].replace("/", "--") / base["revision"]


def teacher_dir() -> Path:
    teacher = DATA["teacher"]
    return ROOT / "verifier" / "models" / teacher["id"].replace("/", "--") / "torch" / teacher["revision"]


def dataset_file(source: dict, name: str) -> Path:
    return HERE / "data" / source["id"].replace("/", "--") / source["revision"] / name


def sources() -> list[tuple[str, Path, str]]:
    """(url, local path, sha256) for every pinned file."""
    base = DATA["base"]
    found = [
        (f"https://huggingface.co/{base['id']}/resolve/{base['revision']}/{name}", base_dir() / name, sha)
        for name, sha in base["files"].items()
    ]
    teacher = DATA["teacher"]
    found += [
        (f"https://huggingface.co/{teacher['id']}/resolve/{teacher['revision']}/{name}", teacher_dir() / name, sha)
        for name, sha in teacher["files"].items()
    ]
    for source in (DATA["train"]["multi_nli"], DATA["eval"]["multi_nli"], DATA["eval"]["snli"]):
        for name, sha in source["files"].items():
            url = f"https://huggingface.co/datasets/{source['id']}/resolve/{source['revision']}/{name}"
            found.append((url, dataset_file(source, name), sha))
    return found


def main() -> int:
    for url, target, sha in sources():
        download(url, target, sha)
        print(f"{target.relative_to(ROOT)}: ok")
    challenge = ROOT / DATA["challenge"]["file"]
    if sha256_of(challenge) != DATA["challenge"]["sha256"]:
        raise SystemExit("the challenge set changed after it was frozen: it is development data now (decision 004)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
