#!/usr/bin/env bash
# Move the secrets and state to a new server. Usage: deploy/move.sh root@OLD root@NEW (docs/server.md).
# Run after deploy/setup.sh on NEW and before deploy/deploy.sh to it. Everything on OLD stops first: two bots would
# double-reply and fight over the rotating X token, two workers would sign twice. The files pass through a pipe only.
set -euo pipefail
OLD="${1:?usage: deploy/move.sh root@OLD root@NEW}"
NEW="${2:?usage: deploy/move.sh root@OLD root@NEW}"

ssh "$NEW" 'id vaticeno && id vaticeno-settle' >/dev/null || { echo "run deploy/setup.sh on $NEW first" >&2; exit 1; }

# Disabled too, so a reboot of OLD does not bring a second bot back.
ssh "$OLD" 'set -e; units=$(systemctl list-units "vaticeno*" --all --plain --no-legend | cut -d" " -f1)
  systemctl stop $units; for u in $units; do [ "$(systemctl is-enabled "$u")" != enabled ] || systemctl disable -q "$u"; done
  ! systemctl is-active --quiet vaticeno || { echo "the bot still runs on OLD" >&2; exit 1; }'

# Owners are restored by name, so different user ids on NEW do not matter.
ssh "$OLD" 'cd / && tar -cz opt/vaticeno/.env* opt/vaticeno/.state etc/vaticeno-settle' \
  | ssh "$NEW" 'cd / && tar -xzp --same-owner && ls -la /opt/vaticeno/.state /etc/vaticeno-settle'

echo "secrets on $NEW. Next: deploy/deploy.sh $NEW, then point vaticeno.n30sk.cc at it (docs/server.md)."
