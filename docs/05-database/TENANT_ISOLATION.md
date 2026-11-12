# Database Tenant Isolation & PostgreSQL RLS Strategy

## 1. Multi-Layered Tenant Isolation

SalonFlow enforces **three independent defense layers** so a single coding omission cannot leak Tenant A's data to Tenant B:

1. **Layer 1 — Session Context Resolution**:
   - Services never accept untrusted `organizationId` parameters from request bodies.
   - `AuthContextService` binds `organizationId` and permitted `branchIds[]` from the server session.
2. **Layer 2 — Composite Foreign Keys & Explicit `organizationId` Predicates**:
   - All tenant tables carry `organizationId`, composite unique indexes `(organizationId, id)`, and composite FKs.
   - All Prisma queries explicitly filter by `organizationId` (and `branchId` for branch-scoped queries).
3. **Layer 3 — PostgreSQL Row-Level Security (RLS) Defense-in-Depth**:
   - Enabled and `FORCE`d across **18 tenant-owned tables**:
     - **12 Organization-Scoped Tables**: `staff_roles`, `role_permissions`, `organization_members`, `staff_branch_access`, `branches`, `salon_settings`, `services`, `token_services`, `push_subscriptions`, `notification_events`, `notifications`, `notification_deliveries`.
     - **1 Nullable-Org Table**: `audit_logs` (denies NULL `organization_id` rows unless `app.bypass_rls = 'on'`).
     - **5 Organization + Optional Branch-Scoped Tables**: `business_hours`, `customers`, `branch_services`, `queue_counters`, `tokens` (enforce both `app.current_organization_id` AND optional `app.current_branch_id` when set via `withBranchDb`).

---

## 2. PostgreSQL RLS Architecture & PgBouncer Compatibility

### How RLS Works with Prisma + Connection Pooling
Because Prisma queries reuse pooled database connections (`DATABASE_URL`), **session-level** `SET app.current_organization_id` would leak across requests if a connection returned to PgBouncer!
Therefore, SalonFlow uses **transaction-local** context via `set_config(..., true)`:

```sql
-- Applied in committed Prisma migration 20261112143500_rls_constraints_and_permissions:
ALTER TABLE "tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_branch_isolation_tokens" ON "tokens"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
      AND (
        NULLIF(current_setting('app.current_branch_id', true), '') IS NULL
        OR "branch_id"::text = NULLIF(current_setting('app.current_branch_id', true), '')
      )
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
      AND (
        NULLIF(current_setting('app.current_branch_id', true), '') IS NULL
        OR "branch_id"::text = NULLIF(current_setting('app.current_branch_id', true), '')
      )
    )
  );
```

### Prisma Tenant Wrappers (`withTenantDb` & `withBranchDb` in `src/server/db/tenant-db.ts`)
- Validates `organizationId` (and optional `branchId`) as strict UUIDs before opening any transaction.
- Uses `AsyncLocalStorage` to reject nested `withTenantDb()` or `withSystemDb()` calls (`TenantContextError`), preventing accidental context switching.
- Runs inside `internalPrisma.$transaction(async (tx) => { ... })` and clears `app.bypass_rls` while setting transaction-local `app.current_organization_id` and `app.current_branch_id` via `set_config(..., true)` (auto-cleared on commit OR rollback, 100% PgBouncer-safe).
- ESLint `no-restricted-imports` prevents `src/server/services/*` from importing `@/server/db/client` directly.
- **Database Role Hygiene**: Runtime (`DATABASE_URL`, `TEST_DATABASE_URL`) connects as `app_runtime` (`NOSUPERUSER`, `NOBYPASSRLS`, DML-only, zero schema `CREATE`), while migrations (`DIRECT_URL`) connect as `salonflow_admin`.

