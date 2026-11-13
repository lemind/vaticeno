#!/usr/bin/env bash
# Push code to the VPS and restart. Usage: deploy/deploy.sh root@HOST
# Secrets (.env*, .state/, /etc/vaticeno-settle) are NOT synced here: deploy/move.sh copies them (docs/server.md).
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh root@HOST}"
cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .state --exclude '.env*' --exclude INIT_SPEC.md \
  --exclude .build-info.json --exclude .venv --exclude __pycache__ \
  ./ "$HOST:/opt/vaticeno/"
# What is running, written here and never inferred at runtime (003 FR-002). The node version is the
# server's, so it is read there; the commit and the time are this machine's.
COMMIT="$(git rev-parse HEAD)"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERSION="$(node -p 'require("./package.json").version')"
ssh "$HOST" "cd /opt/vaticeno && printf '{\"commit\":\"%s\",\"deployed_at\":\"%s\",\"node\":\"%s\",\"version\":\"%s\"}\n' \
  '$COMMIT' '$DEPLOYED_AT' \"\$(node --version)\" '$VERSION' > .build-info.json"
ssh "$HOST" 'cd /opt/vaticeno && chown -R vaticeno:vaticeno . && sudo -u vaticeno npm ci --no-audit --no-fund \
  && cp deploy/vaticeno.service /etc/systemd/system/ && systemctl daemon-reload && systemctl restart vaticeno'
# The own feed runs from systemd timers, not from the bot (owner, 2026-11-09): copied and enabled on every deploy.
ssh "$HOST" 'cd /opt/vaticeno && cp deploy/vaticeno-content@.service deploy/vaticeno-content-*.timer /etc/systemd/system/ \
  && systemctl daemon-reload && systemctl enable --now vaticeno-content-{pool,original,digest,record,event,race}.timer'

# The status page: its own virtualenv on the server, never rsynced, and localhost only (003 FR-004).
ssh "$HOST" 'cd /opt/vaticeno && test -x .venv/bin/pip || sudo -u vaticeno python3 -m venv --clear .venv; \
  sudo -u vaticeno .venv/bin/pip install -q --upgrade pip && sudo -u vaticeno .venv/bin/pip install -q ".[status]" \
  && cp deploy/vaticeno-status.service /etc/systemd/system/ && systemctl daemon-reload \
  && systemctl enable --now vaticeno-status && systemctl restart vaticeno-status'

# HTTPS: the Caddyfile in the repo is the one the server runs.
ssh "$HOST" 'cp /opt/vaticeno/deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy'

# The settlement workers: the testnet one and one per market, each only where its env file is on the server.
# Started if stopped, never restarted here (deploy/network-on.sh does that).
ssh "$HOST" 'cd /opt/vaticeno && cp deploy/vaticeno-settle.service deploy/vaticeno-settle@.service /etc/systemd/system/ \
  && systemctl daemon-reload && { test ! -f /etc/vaticeno-settle/env || systemctl enable --now vaticeno-settle; } \
  && for f in /etc/vaticeno-settle/*/env; do test -f "$f" || continue; m=$(basename "$(dirname "$f")"); \
  systemctl enable --now "vaticeno-settle@$m"; done'
