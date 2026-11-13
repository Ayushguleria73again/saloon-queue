#!/usr/bin/env bash
# ==============================================================================
# SalonFlow SaaS Automated Database Backup Script (ADR-020 / BACKUP_AND_RECOVERY.md)
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "${BACKUP_DIR}"

DB_URL="${1:-${DIRECT_URL:-${DATABASE_URL:-}}}"

if [ -z "${DB_URL}" ]; then
  echo "Error: DIRECT_URL or DATABASE_URL must be provided." >&2
  exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/salonflow_backup_${TIMESTAMP}.dump"

echo "[SALONFLOW BACKUP] Starting database backup at $(date)..."
echo "[SALONFLOW BACKUP] Output destination: ${BACKUP_FILE}"

# Custom format (-Fc) is compressed, flexible for selective restores, and preserves RLS
pg_dump "${DB_URL}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="${BACKUP_FILE}"

FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[SALONFLOW BACKUP] Backup completed successfully! Size: ${FILE_SIZE}"

# Retention: retain last 7 daily backup dumps
find "${BACKUP_DIR}" -name "salonflow_backup_*.dump" -mtime +7 -delete || true
echo "[SALONFLOW BACKUP] Retention cleanup complete."

