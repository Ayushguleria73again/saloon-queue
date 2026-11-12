-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('WAITING', 'CALLED', 'IN_SERVICE', 'COMPLETED', 'SKIPPED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "TokenSource" AS ENUM ('QR', 'WALK_IN');

-- CreateEnum
CREATE TYPE "PushSubscriberType" AS ENUM ('OWNER_STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WEB_PUSH');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'RETRYING', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'ACCEPTED_BY_PROVIDER', 'RETRYING', 'FAILED', 'DEAD_LETTER', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('CUSTOMER', 'OWNER', 'STAFF', 'PLATFORM_ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "email_verification_token_hash" VARCHAR(128),
    "email_verification_expires_at" TIMESTAMPTZ,
    "password_hash" TEXT NOT NULL,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "is_system_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "staff_role_id" UUID NOT NULL,
    "permission_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "staff_role_id" UUID NOT NULL,
    "all_branches" BOOLEAN NOT NULL DEFAULT false,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invite_token_hash" VARCHAR(128),
    "invite_expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_branch_access" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_branch_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(20),
    "address" VARCHAR(300),
    "city" VARCHAR(80),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "qr_token" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salon_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "token_prefix" VARCHAR(8) NOT NULL DEFAULT 'A',
    "active_stations_count" INTEGER NOT NULL DEFAULT 1,
    "allow_duplicate_active_tokens" BOOLEAN NOT NULL DEFAULT false,
    "allow_customer_cancel" BOOLEAN NOT NULL DEFAULT true,
    "enforce_business_hours" BOOLEAN NOT NULL DEFAULT true,
    "is_accepting_tokens" BOOLEAN NOT NULL DEFAULT true,
    "queue_paused_reason" VARCHAR(200),
    "require_valid_qr_token" BOOLEAN NOT NULL DEFAULT false,
    "day_reset_time" VARCHAR(5) NOT NULL DEFAULT '00:00',
    "estimated_buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "customer_push_thresholds" INTEGER[] DEFAULT ARRAY[3, 1]::INTEGER[],
    "notify_delay_threshold_minutes" INTEGER NOT NULL DEFAULT 15,
    "long_queue_alert_threshold" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "salon_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "open_time" VARCHAR(5) NOT NULL DEFAULT '09:30',
    "close_time" VARCHAR(5) NOT NULL DEFAULT '21:30',
    "break_start_time" VARCHAR(5),
    "break_end_time" VARCHAR(5),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "country_code" VARCHAR(8) NOT NULL DEFAULT '+91',
    "mobile_number" VARCHAR(15) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    "base_price_in_paise" INTEGER NOT NULL,
    "base_duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "price_override_in_paise" INTEGER,
    "duration_override_minutes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "branch_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_counters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "prefix" VARCHAR(8) NOT NULL DEFAULT 'A',
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "queue_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" UUID NOT NULL,
    "public_id" VARCHAR(32) NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "token_number" VARCHAR(16) NOT NULL,
    "source" "TokenSource" NOT NULL DEFAULT 'QR',
    "requeued_from_token_id" UUID,
    "customer_name_snapshot" VARCHAR(100) NOT NULL,
    "customer_mobile_snapshot" VARCHAR(15) NOT NULL,
    "notes" VARCHAR(300),
    "status" "TokenStatus" NOT NULL DEFAULT 'WAITING',
    "total_price_in_paise" INTEGER NOT NULL,
    "total_duration_minutes" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMPTZ,
    "service_started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "skipped_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "no_show_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "token_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "service_name_snapshot" VARCHAR(100) NOT NULL,
    "price_in_paise_snapshot" INTEGER NOT NULL,
    "duration_minutes_snapshot" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "subscriber_type" "PushSubscriberType" NOT NULL,
    "user_id" UUID,
    "token_id" UUID,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "device_label" VARCHAR(120),
    "preferences" JSONB,
    "consent_given_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" VARCHAR(64),
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "token_id" UUID,
    "event_type" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_attempt_at" TIMESTAMPTZ,
    "locked_until" TIMESTAMPTZ,
    "locked_by" VARCHAR(100),
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "notification_event_id" UUID NOT NULL,
    "push_subscription_id" UUID,
    "recipient_user_id" UUID,
    "token_id" UUID,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'WEB_PUSH',
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "target_url" VARCHAR(300) NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "acknowledged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL,
    "http_status_code" INTEGER,
    "provider_response" JSONB,
    "error_code" VARCHAR(64),
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "attempted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "branch_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(48) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "ip_address_hash" VARCHAR(64),
    "user_agent" VARCHAR(256),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "staff_roles_organization_id_slug_key" ON "staff_roles"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "staff_roles_organization_id_id_key" ON "staff_roles"("organization_id", "id");

-- CreateIndex
CREATE INDEX "role_permissions_organization_id_staff_role_id_idx" ON "role_permissions"("organization_id", "staff_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_staff_role_id_permission_key_key" ON "role_permissions"("staff_role_id", "permission_key");

-- CreateIndex
CREATE INDEX "organization_members_user_id_status_idx" ON "organization_members"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_id_key" ON "organization_members"("organization_id", "id");

-- CreateIndex
CREATE INDEX "staff_branch_access_organization_id_branch_id_idx" ON "staff_branch_access"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_branch_access_member_id_branch_id_key" ON "staff_branch_access"("member_id", "branch_id");

-- CreateIndex
CREATE INDEX "branches_organization_id_is_active_idx" ON "branches"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_slug_key" ON "branches"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_id_key" ON "branches"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salon_settings_organization_id_branch_id_key" ON "salon_settings"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "business_hours_organization_id_branch_id_idx" ON "business_hours"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_hours_branch_id_day_of_week_key" ON "business_hours"("branch_id", "day_of_week");

-- CreateIndex
CREATE INDEX "customers_organization_id_branch_id_idx" ON "customers"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_branch_id_mobile_number_key" ON "customers"("branch_id", "mobile_number");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_branch_id_id_key" ON "customers"("organization_id", "branch_id", "id");

-- CreateIndex
CREATE INDEX "services_organization_id_is_active_sort_order_idx" ON "services"("organization_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "services_organization_id_id_key" ON "services"("organization_id", "id");

-- CreateIndex
CREATE INDEX "branch_services_branch_id_is_available_sort_order_idx" ON "branch_services"("branch_id", "is_available", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "branch_services_branch_id_service_id_key" ON "branch_services"("branch_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_services_organization_id_branch_id_service_id_key" ON "branch_services"("organization_id", "branch_id", "service_id");

-- CreateIndex
CREATE INDEX "queue_counters_organization_id_branch_id_idx" ON "queue_counters"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_counters_branch_id_business_date_prefix_key" ON "queue_counters"("branch_id", "business_date", "prefix");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_public_id_key" ON "tokens"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_requeued_from_token_id_key" ON "tokens"("requeued_from_token_id");

-- CreateIndex
CREATE INDEX "tokens_organization_id_branch_id_business_date_status_seque_idx" ON "tokens"("organization_id", "branch_id", "business_date", "status", "sequence_number");

-- CreateIndex
CREATE INDEX "tokens_branch_id_customer_id_status_idx" ON "tokens"("branch_id", "customer_id", "status");

-- CreateIndex
CREATE INDEX "tokens_organization_id_branch_id_created_at_id_idx" ON "tokens"("organization_id", "branch_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tokens_organization_id_id_key" ON "tokens"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_organization_id_branch_id_id_key" ON "tokens"("organization_id", "branch_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_organization_id_branch_id_requeued_from_token_id_key" ON "tokens"("organization_id", "branch_id", "requeued_from_token_id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_branch_id_business_date_sequence_number_key" ON "tokens"("branch_id", "business_date", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_branch_id_business_date_token_number_key" ON "tokens"("branch_id", "business_date", "token_number");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_branch_id_idempotency_key_key" ON "tokens"("branch_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "token_services_token_id_idx" ON "token_services"("token_id");

-- CreateIndex
CREATE INDEX "token_services_organization_id_service_id_idx" ON "token_services"("organization_id", "service_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_organization_id_subscriber_type_is_activ_idx" ON "push_subscriptions"("organization_id", "subscriber_type", "is_active", "branch_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_token_id_is_active_idx" ON "push_subscriptions"("token_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_organization_id_id_key" ON "push_subscriptions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "notification_events_status_next_attempt_at_locked_until_idx" ON "notification_events"("status", "next_attempt_at", "locked_until");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_organization_id_idempotency_key_key" ON "notification_events"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_organization_id_id_key" ON "notification_events"("organization_id", "id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_created_at_idx" ON "notifications"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organization_id_id_key" ON "notifications"("organization_id", "id");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_attempt_number_idx" ON "notification_deliveries"("notification_id", "attempt_number");

-- CreateIndex
CREATE INDEX "notification_deliveries_organization_id_attempted_at_idx" ON "notification_deliveries"("organization_id", "attempted_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_staff_role_id_fkey" FOREIGN KEY ("organization_id", "staff_role_id") REFERENCES "staff_roles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_staff_role_id_fkey" FOREIGN KEY ("organization_id", "staff_role_id") REFERENCES "staff_roles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branch_access" ADD CONSTRAINT "staff_branch_access_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "organization_members"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branch_access" ADD CONSTRAINT "staff_branch_access_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_settings" ADD CONSTRAINT "salon_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_settings" ADD CONSTRAINT "salon_settings_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_counters" ADD CONSTRAINT "queue_counters_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_organization_id_branch_id_customer_id_fkey" FOREIGN KEY ("organization_id", "branch_id", "customer_id") REFERENCES "customers"("organization_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_organization_id_branch_id_requeued_from_token_id_fkey" FOREIGN KEY ("organization_id", "branch_id", "requeued_from_token_id") REFERENCES "tokens"("organization_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_services" ADD CONSTRAINT "token_services_organization_id_token_id_fkey" FOREIGN KEY ("organization_id", "token_id") REFERENCES "tokens"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_services" ADD CONSTRAINT "token_services_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organization_id_token_id_fkey" FOREIGN KEY ("organization_id", "token_id") REFERENCES "tokens"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_organization_id_token_id_fkey" FOREIGN KEY ("organization_id", "token_id") REFERENCES "tokens"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_notification_event_id_fkey" FOREIGN KEY ("organization_id", "notification_event_id") REFERENCES "notification_events"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_push_subscription_id_fkey" FOREIGN KEY ("organization_id", "push_subscription_id") REFERENCES "push_subscriptions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_token_id_fkey" FOREIGN KEY ("organization_id", "token_id") REFERENCES "tokens"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_notification_id_fkey" FOREIGN KEY ("organization_id", "notification_id") REFERENCES "notifications"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
