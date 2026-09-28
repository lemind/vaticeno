#!/usr/bin/env bash
# Push code to the VPS and restart. Usage: deploy/deploy.sh root@HOST
# Secrets (.env, .state/) are NOT synced here — they are copied once, by hand (see docs/poc-x-setup.md).
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh root@HOST}"
cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .state --exclude .env --exclude INIT_SPEC.md \
  ./ "$HOST:/opt/vaticeno/"
ssh "$HOST" 'cd /opt/vaticeno && chown -R vaticeno:vaticeno . && sudo -u vaticeno npm ci --no-audit --no-fund \
  && cp deploy/vaticeno.service /etc/systemd/system/ && systemctl daemon-reload && systemctl restart vaticeno'
