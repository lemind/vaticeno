#!/usr/bin/env bash
# Build the verifier image from the repo and deploy it to Cloud Run (003 T346, decision 005).
# Only what the service imports goes into the image. The key lives in Secret Manager as `verifier-key`.
set -euo pipefail
cd "$(dirname "$0")/../.."
PROJECT="${PROJECT:?set PROJECT to the Google Cloud project id}"
REGION="${REGION:-us-central1}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/verifier/vaticeno-verifier:$(git rev-parse --short HEAD)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
mkdir -p "$OUT/verifier/serve"
cp verifier/serve/{Dockerfile,requirements.txt} "$OUT/"
cp verifier/{__init__.py,fetch_model.py,nli.py,model.toml} "$OUT/verifier/"
cp verifier/serve/{__init__.py,app.py,model.toml} "$OUT/verifier/serve/"
docker build -t "$IMAGE" "$OUT"
docker push "$IMAGE"
# Private: Google refuses a call without an identity token; scales to zero, one instance, one request at a time:
# one CPU reads one page at a time, and four together took 12 s and refused three (measured 2026-10-26).
gcloud run deploy vaticeno-verifier --project="$PROJECT" --region="$REGION" --image="$IMAGE" \
  --port=7860 --memory=1Gi --cpu=1 --min-instances=0 --max-instances=1 --concurrency=1 --timeout=60 \
  --set-secrets=VERIFIER_KEY=verifier-key:latest --no-allow-unauthenticated --quiet
