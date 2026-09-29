#!/usr/bin/env bash
# One-time VPS bootstrap (Ubuntu 24.04, run as root). Idempotent.
set -euo pipefail

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id vaticeno &>/dev/null || useradd --system --home /opt/vaticeno --shell /usr/sbin/nologin vaticeno
mkdir -p /opt/vaticeno/.state
chown -R vaticeno:vaticeno /opt/vaticeno
