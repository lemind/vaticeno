#!/usr/bin/env bash
# The practice model end to end (003 T343a-b, docs/decisions/004-practice-model.md). Training wants a GPU:
# about 45 minutes on a Colab T4, about 17 hours on this laptop's CPU. The rest runs on a CPU in minutes.
set -euo pipefail
cd "$(dirname "$0")/../.."
uv venv .venv-train --python 3.12 -q --allow-existing
uv pip sync --python .venv-train/bin/python --extra-index-url https://download.pytorch.org/whl/cpu \
  --index-strategy unsafe-best-match verifier/train/requirements.lock -q
PY=.venv-train/bin/python
$PY -m pytest -q verifier/train
$PY -m verifier.train.fetch_data
[ "${SKIP_TRAINING:-}" = 1 ] || $PY -m verifier.train.finetune
$PY -m verifier.train.evaluate
$PY -m verifier.train.report
