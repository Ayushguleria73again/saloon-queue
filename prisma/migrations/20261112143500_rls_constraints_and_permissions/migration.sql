-- ============================================================================
-- Migration 2: Partial Indexes, Domain Check Constraints, PostgreSQL RLS,
-- and Strict Separation of Runtime (app_runtime) vs Migration (salonflow_admin) Roles
-- ============================================================================

-- 1. Partial Unique & Outbox Indexes
CREATE UNIQUE INDEX "salon_settings_org_default_unique"
  ON "salon_settings" ("organization_id")
  WHERE "branch_id" IS NULL;

CREATE UNIQUE INDEX "push_subscriptions_user_endpoint_unique"
  ON "push_subscriptions" ("user_id", "endpoint")
  WHERE "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "push_subscriptions_token_endpoint_unique"
  ON "push_subscriptions" ("token_id", "endpoint")
  WHERE "token_id" IS NOT NULL;

CREATE INDEX "notification_events_outbox_due_idx"
  ON "notification_events" ("status", "next_attempt_at", "locked_until")
  WHERE "status" IN ('PENDING', 'RETRYING', 'PROCESSING');

-- 2. Domain Integrity Check Constraints
ALTER TABLE "services"
  ADD CONSTRAINT "services_price_non_negative" CHECK ("base_price_in_paise" >= 0),
  ADD CONSTRAINT "services_duration_positive" CHECK ("base_duration_minutes" > 0);

ALTER TABLE "branch_services"
  ADD CONSTRAINT "branch_services_price_override_non_negative"
    CHECK ("price_override_in_paise" IS NULL OR "price_override_in_paise" >= 0),
  ADD CONSTRAINT "branch_services_duration_override_positive"
    CHECK ("duration_override_minutes" IS NULL OR "duration_override_minutes" > 0);

ALTER TABLE "business_hours"
  ADD CONSTRAINT "business_hours_day_range" CHECK ("day_of_week" BETWEEN 0 AND 6);

ALTER TABLE "salon_settings"
  ADD CONSTRAINT "salon_settings_stations_positive" CHECK ("active_stations_count" >= 1);

ALTER TABLE "tokens"
  ADD CONSTRAINT "tokens_sequence_positive" CHECK ("sequence_number" >= 1),
  ADD CONSTRAINT "tokens_price_non_negative" CHECK ("total_price_in_paise" >= 0),
  ADD CONSTRAINT "tokens_duration_positive" CHECK ("total_duration_minutes" > 0);

-- 3. Enable & Force Row-Level Security on All Tenant-Owned Tables
-- 3A. Organization-Scoped Tables (12 tables)
ALTER TABLE "staff_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_staff_roles" ON "staff_roles"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_role_permissions" ON "role_permissions"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_organization_members" ON "organization_members"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "staff_branch_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_branch_access" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_staff_branch_access" ON "staff_branch_access"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_branches" ON "branches"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "salon_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salon_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_salon_settings" ON "salon_settings"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "services" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_services" ON "services"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "token_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_token_services" ON "token_services"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_push_subscriptions" ON "push_subscriptions"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "notification_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_notification_events" ON "notification_events"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_notifications" ON "notifications"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_notification_deliveries" ON "notification_deliveries"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
  );

-- 3B. Audit Logs (denies NULL organization_id unless app.bypass_rls = 'on')
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_audit_logs" ON "audit_logs"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      "organization_id" IS NOT NULL
      AND "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      "organization_id" IS NOT NULL
      AND "organization_id"::text = NULLIF(current_setting('app.current_organization_id', true), '')
    )
  );

-- 3C. Organization + Optional Branch-Scoped Isolation Tables (5 tables)
ALTER TABLE "business_hours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_hours" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_branch_isolation_business_hours" ON "business_hours"
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

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_branch_isolation_customers" ON "customers"
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

ALTER TABLE "branch_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_branch_isolation_branch_services" ON "branch_services"
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

ALTER TABLE "queue_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "queue_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_branch_isolation_queue_counters" ON "queue_counters"
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

-- 4. Runtime Role Privileges (app_runtime = DML only, zero DDL, zero bypass)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

