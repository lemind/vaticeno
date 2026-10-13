#!/usr/bin/env bash
# Push code to the VPS and restart. Usage: deploy/deploy.sh root@HOST
# Secrets (.env, .state/) are NOT synced here — they are copied once, by hand (see docs/poc-x-setup.md).
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh root@HOST}"
cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .state --exclude .env --exclude .env.production --exclude INIT_SPEC.md \
  --exclude .build-info.json --exclude .venv --exclude __pycache__ \
  ./ "$HOST:/opt/vaticeno/"
# What is running, written here and never inferred at runtime (003 FR-002). The node version is the
# server's, so it is read there; the commit and the time are this machine's.
COMMIT="$(git rev-parse HEAD)"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ssh "$HOST" "cd /opt/vaticeno && printf '{\"commit\":\"%s\",\"deployed_at\":\"%s\",\"node\":\"%s\"}\n' \
  '$COMMIT' '$DEPLOYED_AT' \"\$(node --version)\" > .build-info.json"
ssh "$HOST" 'cd /opt/vaticeno && chown -R vaticeno:vaticeno . && sudo -u vaticeno npm ci --no-audit --no-fund \
  && cp deploy/vaticeno.service /etc/systemd/system/ && systemctl daemon-reload && systemctl restart vaticeno'
