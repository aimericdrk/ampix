#!/usr/bin/env bash
# Nightly backup of the MyAmpix metadata databases. Run by myampix-backup.timer (03:30 UTC daily),
# or on demand from the admin console (see TRIGGER below).
#
#   - Postgres `myampix`        → custom-format pg_dump (analytics metadata: orgs, users, projects, tokens)
#   - Postgres `admin_console`  → custom-format pg_dump (admin console users, alerts, samples)
#   - Postgres `mobile_purchase`→ custom-format pg_dump (apps, subscribers, entitlements, purchases)
#
# ClickHouse (the raw event store) is deliberately NOT backed up: it is by far the largest and
# fastest-growing dataset here, and it is reconstructible telemetry rather than system-of-record
# state — everything that defines the product (accounts, orgs, projects, ingest tokens, billing) is
# in the three Postgres databases above. The ClickHouse `backups` disk is still configured
# (infra/clickhouse/config.d/backups.xml), so a one-off snapshot is always available on demand:
#   docker exec myampix-clickhouse-1 clickhouse-client --user default --password "$CLICKHOUSE_PASSWORD" \
#     --query "BACKUP DATABASE analytics TO Disk('backups','manual-$(date -u +%Y%m%dT%H%M%SZ).zip')"
#
# Restore:  pg_restore --clean --if-exists -d <db> <file.dump>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${BACKUP_DEST:-/var/backups/myampix}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STARTED_EPOCH=$(date -u +%s)

# The admin console cannot talk to systemd from inside its pod, so it requests a run by creating
# this file in the (bind-mounted) backup directory; myampix-backup-trigger.path notices and starts
# the service. Removed first thing so a run is never re-triggered by its own leftover marker.
TRIGGER="$DEST/.run-now"
TRIGGERED_BY="schedule"
if [ -f "$TRIGGER" ]; then
  TRIGGERED_BY="$(head -c 200 "$TRIGGER" 2>/dev/null | tr -d '\n"\\' || true)"
  TRIGGERED_BY="${TRIGGERED_BY:-console}"
  rm -f "$TRIGGER"
fi

# Credentials come from the same gitignored file the datastores themselves are started with.
set -a; . "$ROOT/infra/.env.prod"; set +a

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
fail=0
results=""

mkdir -p "$DEST/postgres"

add_result() { # <db> <ok|fail> <bytes>
  [ -n "$results" ] && results="$results,"
  results="$results{\"database\":\"$1\",\"status\":\"$2\",\"bytes\":$3}"
}

dump_pg() { # <container> <user> <db> <password>
  local container="$1" user="$2" db="$3" out="$DEST/postgres/$3-$STAMP.dump"
  if docker exec -e PGPASSWORD="$4" "$container" \
       pg_dump -U "$user" -d "$db" --format=custom --compress=6 > "$out" 2>/dev/null; then
    local bytes; bytes=$(stat -c %s "$out")
    log "OK   postgres/$db → $(numfmt --to=iec "$bytes" 2>/dev/null || echo "${bytes}B")"
    add_result "$db" ok "$bytes"
  else
    log "FAIL postgres/$db"; rm -f "$out"; fail=1
    add_result "$db" fail 0
  fi
}

dump_pg myampix-postgres-1                 myampix         myampix         "$POSTGRES_PASSWORD"
dump_pg myampix-postgres-1                 myampix         admin_console   "$POSTGRES_PASSWORD"
dump_pg myampix-mobile-purchase-postgres-1 mobile_purchase mobile_purchase "$MOBILE_PURCHASE_POSTGRES_PASSWORD"

# Retention. -mtime +N deletes strictly older than N days, so RETENTION_DAYS nights are always kept.
pruned=$(find "$DEST/postgres" -name '*.dump' -mtime "+$RETENTION_DAYS" -print -delete 2>/dev/null | wc -l)
[ "$pruned" -gt 0 ] && log "pruned $pruned backup(s) older than ${RETENTION_DAYS}d"

total_files=$(find "$DEST/postgres" -name '*.dump' | wc -l)
total_bytes=$(du -sb "$DEST/postgres" 2>/dev/null | cut -f1)
log "retained: $total_files files, $(numfmt --to=iec "${total_bytes:-0}" 2>/dev/null || echo "${total_bytes}B") total"

# Machine-readable status for the admin console's Backups page. Written last and atomically (temp
# file + mv) so a reader never sees a half-written record.
cat > "$DEST/.last-run.json.tmp" <<EOF
{
  "finishedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "startedAt": "$(date -u -d "@$STARTED_EPOCH" +%Y-%m-%dT%H:%M:%SZ)",
  "durationSeconds": $(( $(date -u +%s) - STARTED_EPOCH )),
  "status": "$([ "$fail" -eq 0 ] && echo ok || echo failed)",
  "triggeredBy": "$TRIGGERED_BY",
  "retentionDays": $RETENTION_DAYS,
  "prunedCount": $pruned,
  "results": [$results]
}
EOF
mv "$DEST/.last-run.json.tmp" "$DEST/.last-run.json"
# The console reads this through a group-readable bind mount; 0640 keeps it off-limits to others.
chmod 640 "$DEST/.last-run.json" 2>/dev/null || true

[ "$fail" -eq 0 ] || { log "one or more backups FAILED"; exit 1; }
log "backup complete (triggered by: $TRIGGERED_BY)"
