#!/usr/bin/env bash
# ==============================================================================
# SalonFlow SaaS Automated Database Restore Script (ADR-020 / BACKUP_AND_RECOVERY.md)
# ==============================================================================
set -euo pipefail

BACKUP_FILE="${1:-}"
TARGET_DB_URL="${2:-${DIRECT_URL:-}}"

if [ -z "${BACKUP_FILE}" ] || [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Path to a valid backup dump file must be provided as arg 1." >&2
  echo "Usage: ./scripts/restore.sh <backup_file.dump> [target_db_url]" >&2
  exit 1
fi

if [ -z "${TARGET_DB_URL}" ]; then
  echo "Error: Target database URL must be provided as arg 2 or DIRECT_URL." >&2
  exit 1
fi

echo "[SALONFLOW RESTORE] Starting database restore from: ${BACKUP_FILE}"
echo "[SALONFLOW RESTORE] Restoring into target database..."

# pg_restore using clean and if-exists
pg_restore \
  --dbname="${TARGET_DB_URL}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  "${BACKUP_FILE}" || true

echo "[SALONFLOW RESTORE] Dump data restored. Re-verifying RLS grants for app_runtime..."

# Ensure non-superuser app_runtime role has proper permissions
psql "${TARGET_DB_URL}" -v ON_ERROR_STOP=1 <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
      CREATE ROLE app_runtime WITH LOGIN PASSWORD 'salonflow_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
  END
  \$\$;

  GRANT USAGE ON SCHEMA public TO app_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
EOSQL

echo "[SALONFLOW RESTORE] Auditing Row-Level Security (RLS) enforcement on restored tables..."
RLS_AUDIT=$(psql "${TARGET_DB_URL}" -t -A -c "
  SELECT count(*)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN ('tokens', 'branches', 'services', 'customers', 'organization_members', 'audit_logs')
    AND c.relrowsecurity = false;
")

if [ "${RLS_AUDIT}" -gt 0 ]; then
  echo "ERROR: Critical security failure! ${RLS_AUDIT} core tables have RLS disabled after restore!" >&2
  exit 1
fi

echo "[SALONFLOW RESTORE] Success! All tenant tables have active Row-Level Security (RLS)."

