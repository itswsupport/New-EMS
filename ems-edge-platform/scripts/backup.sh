#!/usr/bin/env bash
# =============================================================================
# backup.sh — nightly logical backup of the edge database.
# Cron:  0 2 * * * /opt/ems-edge-platform/scripts/backup.sh >> /var/log/ems-backup.log 2>&1
#
# Writes a compressed custom-format dump (restorable with pg_restore) and prunes
# anything older than RETENTION_DAYS. For higher volume, move to physical
# backups + WAL archiving (see docs/operations.md).
# =============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

BACKUP_DIR="${BACKUP_DIR:-/opt/ems-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_USER="${POSTGRES_USER:-ems}"
PG_DB="${POSTGRES_DB:-ems}"
STAMP="$(date +%F_%H%M)"
OUT="${BACKUP_DIR}/ems_${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping ${PG_DB} -> ${OUT}"
docker compose exec -T postgres pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$OUT"

# Fail loudly if the dump is suspiciously small (empty/failed dump).
SIZE=$(stat -c%s "$OUT")
if [[ "$SIZE" -lt 1024 ]]; then
  echo "[backup] ERROR: dump is only ${SIZE} bytes — treating as failed"
  rm -f "$OUT"
  exit 1
fi

echo "[backup] ok (${SIZE} bytes). Pruning older than ${RETENTION_DAYS}d..."
find "$BACKUP_DIR" -name 'ems_*.dump' -mtime "+${RETENTION_DAYS}" -delete

# Also archive any dead-letter records so they are never lost with the host.
if [[ -s logs/dead-letter.ndjson ]]; then
  cp logs/dead-letter.ndjson "${BACKUP_DIR}/dead-letter_${STAMP}.ndjson"
  echo "[backup] archived dead-letter records"
fi

echo "[backup] done."
