"""The verifier service (003 T346, docs/decisions/005-verifier-on-cloud-run.md): one endpoint that reads a page
against a claim and answers with the model's strongest entailment and contradiction. No database, nothing
stored, and no request text in any log line. Runs as the private Cloud Run service `vaticeno-verifier`.

    VERIFIER_KEY=... .venv/bin/uvicorn verifier.serve.app:app --port 7860
"""

from __future__ import annotations

import hmac
import logging
import os
import time
import tomllib
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from verifier.fetch_model import download
from verifier.nli import Verifier

HERE = Path(__file__).resolve().parent
SPEC = tomllib.loads((HERE / "model.toml").read_text())
MODEL_DIR = Path(os.environ.get("VERIFIER_MODEL_DIR", HERE.parents[1] / "verifier" / "models" / "served"))
MODEL = f"{SPEC['id']}@{SPEC['revision'][:7]}"
# The resolver reads at most 40,000 characters a page (src/resolve/fetch.ts); 32 windows cover about 12k tokens.
MAX_CHARS = 40_000
MAX_WINDOWS = 32

log = logging.getLogger("vaticeno.verifier")


def fetch() -> None:
    """The pinned files, checked by sha256; a bad download is never left where the session would load it."""
    for name, sha in SPEC["files"].items():
        download(f"https://huggingface.co/{SPEC['id']}/resolve/{SPEC['revision']}/{name}", MODEL_DIR / name, sha)


class Pair(BaseModel):
    premise: str = Field(min_length=1, max_length=MAX_CHARS)  # the page text, in memory only
    hypothesis: str = Field(min_length=1, max_length=2_000)  # the claim's criterion


class Answer(BaseModel):
    model: str
    entail: float | None  # None: no opinion (an empty page or a claim too long to read beside it)
    contradict: float | None
    windows: int
    truncated: bool
    ms: int


def require_key(x_verifier_key: str = Header(default="")) -> None:
    # A second lock behind Cloud Run's IAM check: the key only Node and the service hold (decision 005).
    expected = os.environ.get("VERIFIER_KEY", "")
    if not expected or not hmac.compare_digest(x_verifier_key, expected):
        raise HTTPException(status_code=401, detail="missing or wrong key")


fetch()
verifier = Verifier(SPEC, MODEL_DIR)
app = FastAPI(title="vaticeno-verifier", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict:
    return {"model": MODEL}


@app.post("/score", dependencies=[Depends(require_key)])
def score(pair: Pair) -> Answer:
    started = time.monotonic()
    result = verifier.score(pair.premise, pair.hypothesis, max_windows=MAX_WINDOWS)
    ms = int((time.monotonic() - started) * 1000)
    # Numbers only: the page and the claim never reach a log line (constitution V).
    log.info("scored windows=%s ms=%s", result.windows if result else 0, ms)
    return Answer(
        model=MODEL,
        entail=result.entail if result else None,
        contradict=result.contradict if result else None,
        windows=result.windows if result else 0,
        truncated=result.truncated if result else False,
        ms=ms,
    )
