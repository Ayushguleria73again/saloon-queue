#!/usr/bin/env bash
# ==============================================================================
# SalonFlow SaaS Production Deployment Runner Script (ADR-020 / DEPLOYMENT_GUIDE.md)
# ==============================================================================
set -euo pipefail

echo "======================================================================"
echo " Starting SalonFlow Production Deployment"
echo "======================================================================"

# 1. Environment Variable Validation
if [ -z "${AUTH_SECRET:-}" ] && [ -n "${NEXTAUTH_SECRET:-}" ]; then
  export AUTH_SECRET="${NEXTAUTH_SECRET}"
fi
REQUIRED_VARS=("DATABASE_URL" "DIRECT_URL" "AUTH_SECRET" "IP_HASH_SALT" "NEXT_PUBLIC_VAPID_PUBLIC_KEY" "VAPID_PRIVATE_KEY")
for VAR in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!VAR:-}" ]; then
    echo "ERROR: Mandatory environment variable ${VAR} is not set." >&2
    exit 1
  fi
done

# 2. Database Migration via DIRECT_URL
echo "[DEPLOY 1/4] Running PostgreSQL schema migrations (prisma migrate deploy)..."
npx prisma migrate deploy

# 3. Ensure Unprivileged Database Role & Grants (app_runtime)
echo "[DEPLOY 2/4] Verifying unprivileged runtime role permissions (app_runtime)..."
psql "${DIRECT_URL}" -v ON_ERROR_STOP=1 <<-EOSQL
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

# 4. Provision or Update Initial Platform Administrator
echo "[DEPLOY 3/4] Ensuring initial Platform Administrator is provisioned..."
npx vite-node scripts/seed-platform-admin.ts || npx tsx scripts/seed-platform-admin.ts || true

# 5. Verify Row-Level Security Status
echo "[DEPLOY 4/4] Auditing Row-Level Security (RLS) on production database..."
RLS_AUDIT=$(psql "${DIRECT_URL}" -t -A -c "
  SELECT count(*)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN ('tokens', 'branches', 'services', 'customers', 'organization_members', 'audit_logs')
    AND c.relrowsecurity = false;
")

if [ "${RLS_AUDIT}" -gt 0 ]; then
  echo "ERROR: Critical security violation! ${RLS_AUDIT} tenant tables do not have RLS enabled!" >&2
  exit 1
fi

echo "======================================================================"
echo " SalonFlow Production Deployment Prerequisites Verified Successfully!"
echo "======================================================================"

