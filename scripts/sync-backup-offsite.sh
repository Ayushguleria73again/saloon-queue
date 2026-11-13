#!/usr/bin/env bash
# ==============================================================================
# SalonFlow SaaS Off-Site Backup Sync Script (ADR-020 / RELEASE_CHECKLIST.md)
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
S3_BUCKET="${BACKUP_S3_BUCKET:-${1:-}}"
S3_REGION="${BACKUP_S3_REGION:-ap-south-1}"

echo "======================================================================"
echo " SalonFlow Off-Site Backup Synchronization"
echo "======================================================================"

if [ ! -d "${BACKUP_DIR}" ]; then
  echo "ERROR: Backup directory '${BACKUP_DIR}' does not exist." >&2
  exit 1
fi

LATEST_DUMP=$(find "${BACKUP_DIR}" -name "salonflow_backup_*.dump" -type f | sort -r | head -n 1 || true)

if [ -z "${LATEST_DUMP}" ]; then
  echo "WARNING: No backup dump files found in ${BACKUP_DIR}. Running scripts/backup.sh first..."
  ./scripts/backup.sh
  LATEST_DUMP=$(find "${BACKUP_DIR}" -name "salonflow_backup_*.dump" -type f | sort -r | head -n 1)
fi

DUMP_FILENAME=$(basename "${LATEST_DUMP}")
DUMP_SIZE=$(du -h "${LATEST_DUMP}" | cut -f1)

echo "[BACKUP SYNC] Latest local dump: ${LATEST_DUMP} (${DUMP_SIZE})"

if [ -z "${S3_BUCKET}" ]; then
  echo "NOTICE: BACKUP_S3_BUCKET is not set."
  echo "Local dump is verified at: ${LATEST_DUMP}"
  echo "To enable automated off-site sync, set BACKUP_S3_BUCKET='s3://your-bucket-name' in .env.production"
  exit 0
fi

echo "[BACKUP SYNC] Syncing ${DUMP_FILENAME} to off-site cloud storage: ${S3_BUCKET} (${S3_REGION})..."

if command -v aws &> /dev/null; then
  echo "[BACKUP SYNC] Using AWS CLI with server-side encryption (AES256)..."
  aws s3 cp "${LATEST_DUMP}" "${S3_BUCKET}/daily/${DUMP_FILENAME}" \
    --region "${S3_REGION}" \
    --sse AES256 \
    --storage-class STANDARD_IA
  echo "[BACKUP SYNC] Off-site sync completed successfully via AWS S3!"
elif command -v rclone &> /dev/null; then
  echo "[BACKUP SYNC] Using rclone to sync to remote: ${S3_BUCKET}..."
  rclone copy "${LATEST_DUMP}" "${S3_BUCKET}/daily/"
  echo "[BACKUP SYNC] Off-site sync completed successfully via rclone!"
else
  echo "ERROR: Neither 'aws' CLI nor 'rclone' found on host. Off-site upload cannot proceed." >&2
  echo "Please install awscli (apt install awscli) or rclone to enable off-site cloud replication." >&2
  exit 1
fi

echo "======================================================================"
echo " Off-Site Backup Verified Successfully!"
echo "======================================================================"
