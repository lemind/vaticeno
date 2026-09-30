#!/usr/bin/env bash
# Nightly Supabase dump (Free tier has no backups — research R1). Keeps 7 local copies and, when
# BACKUP_REMOTE is set (an rclone remote, e.g. "r2:vaticeno-backups"), copies each dump off the box.
# Reads DATABASE_URL from /opt/vaticeno/.env.production. Restore test: see quickstart.md "Backups".
set -euo pipefail
cd /opt/vaticeno
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.production | cut -d= -f2-)"
BACKUP_REMOTE="$(grep -E '^BACKUP_REMOTE=' .env.production | cut -d= -f2- || true)"
DIR=/var/backups/vaticeno
FILE="$DIR/vaticeno-$(date -u +%Y%m%dT%H%M%SZ).dump"

mkdir -p "$DIR"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$FILE"
ls -1t "$DIR"/vaticeno-*.dump | tail -n +8 | xargs -r rm --
if [ -n "$BACKUP_REMOTE" ]; then
  rclone copy "$FILE" "$BACKUP_REMOTE/"
else
  echo "warning: BACKUP_REMOTE not set — dump kept on this box only" >&2
fi
echo "backup ok: $FILE"
