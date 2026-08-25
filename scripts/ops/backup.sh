#!/usr/bin/env bash
# Nightly backup of every MyAmpix datastore. Run by myampix-backup.timer (03:30 UTC daily).
#   - Postgres `myampix`        → custom-format pg_dump (analytics metadata: orgs, users, projects, tokens)
#   - Postgres `admin_console`  → custom-format pg_dump (admin console users, alerts, samples)
#   - Postgres `mobile_purchase`→ custom-format pg_dump (apps, subscribers, entitlements, purchases)
#   - ClickHouse `analytics`    → native BACKUP to Disk('backups') (the event store)
# Everything lands under /var/backups/myampix and is pruned after RETENTION_DAYS.
#
# Restore (Postgres):  pg_restore --clean --if-exists -d <db> <file.dump>
# Restore (ClickHouse): RESTORE DATABASE analytics FROM Disk('backups','<name>.zip')
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${BACKUP_DEST:-/var/backups/myampix}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# Credentials come from the same gitignored file the datastores themselves are started with.
set -a; . "$ROOT/infra/.env.prod"; set +a

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
fail=0

mkdir -p "$DEST/postgres"

dump_pg() { # <container> <user> <db>
  local container="$1" user="$2" db="$3" out="$DEST/postgres/$3-$STAMP.dump"
  if docker exec -e PGPASSWORD="$4" "$container" \
       pg_dump -U "$user" -d "$db" --format=custom --compress=6 > "$out" 2>/dev/null; then
    log "OK   postgres/$db → $(du -h "$out" | cut -f1)"
  else
    log "FAIL postgres/$db"; rm -f "$out"; fail=1
  fi
}

dump_pg myampix-postgres-1                myampix         myampix         "$POSTGRES_PASSWORD"
dump_pg myampix-postgres-1                myampix         admin_console   "$POSTGRES_PASSWORD"
dump_pg myampix-mobile-purchase-postgres-1 mobile_purchase mobile_purchase "$MOBILE_PURCHASE_POSTGRES_PASSWORD"

# ClickHouse: native backup, consistent across parts, restorable with RESTORE DATABASE.
CH_NAME="analytics-$STAMP.zip"
if docker exec myampix-clickhouse-1 clickhouse-client --user default --password "$CLICKHOUSE_PASSWORD" \
     --query "BACKUP DATABASE analytics TO Disk('backups','$CH_NAME')" >/dev/null 2>&1; then
  log "OK   clickhouse/analytics → $(du -h "$DEST/clickhouse/$CH_NAME" 2>/dev/null | cut -f1)"
else
  log "FAIL clickhouse/analytics"; fail=1
fi

# Prune. -mtime +N deletes strictly older than N days, so RETENTION_DAYS nights are always kept.
find "$DEST/postgres"   -name '*.dump' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
find "$DEST/clickhouse" -name '*.zip'  -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

log "retained: $(find "$DEST" -type f \( -name '*.dump' -o -name '*.zip' \) | wc -l) files, $(du -sh "$DEST" | cut -f1) total"
[ "$fail" -eq 0 ] || { log "one or more backups FAILED"; exit 1; }
log "backup complete"
