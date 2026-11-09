#!/usr/bin/env bash
# One-time VPS bootstrap (Ubuntu 24.04, run as root). Idempotent. The whole server: docs/server.md.
set -euo pipefail

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# The status page runs on the system Python (3.12 on 24.04) in its own virtualenv (003 FR-020).
# The versioned package is the one that carries ensurepip; the meta-package alone left venv broken.
python3 -m venv --help &>/dev/null || apt-get install -y python3.12-venv python3-venv

# Caddy from its own repository: HTTPS for the public pages, certificate fetched by itself (deploy/Caddyfile).
if ! command -v caddy &>/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# Logs capped so the small droplet never fills its disk (research R11).
mkdir -p /etc/systemd/journald.conf.d
if [ ! -f /etc/systemd/journald.conf.d/vaticeno.conf ]; then
  printf '[Journal]\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/vaticeno.conf
  systemctl restart systemd-journald
fi

id vaticeno &>/dev/null || useradd --system --home /opt/vaticeno --shell /usr/sbin/nologin vaticeno
# The settlement workers' own user: the oracle keys are readable by them alone (003 FR-028).
id vaticeno-settle &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin vaticeno-settle
install -d -m 700 -o vaticeno-settle -g vaticeno-settle /etc/vaticeno-settle
mkdir -p /opt/vaticeno/.state
chown -R vaticeno:vaticeno /opt/vaticeno
