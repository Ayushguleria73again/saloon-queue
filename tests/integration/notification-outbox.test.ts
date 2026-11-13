import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { branchCatalogCache } from "@/server/cache/branch-catalog-cache";
import { withTenantDb } from "@/server/db";
import { runNotificationOutboxBatch } from "@/server/notifications/outbox-worker";
import type { PushTransport } from "@/server/notifications/web-push-adapter";
import { createBranch } from "@/server/services/branch-service";
import { createOrganizationService } from "@/server/services/catalog-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import {
  listOwnerNotifications,
  retryOwnerNotification,
  triggerOwnerTestPush,
  upsertOwnerPushSubscription,
} from "@/server/services/owner-notification-service";
import {
  acceptStaffInvite,
  createStaffInvite,
  revokeStaffMember,
} from "@/server/services/staff-service";
import { createPublicToken } from "@/server/services/token-service";

function loadEnvIntoProcess() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvIntoProcess();

const TEST_RUNTIME_URL = process.env.TEST_DATABASE_URL;
const DIRECT_URL = process.env.DIRECT_URL;
if (!TEST_RUNTIME_URL || !DIRECT_URL) {
  throw new Error(
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 11 tests",
  );
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

const OPEN_NOW = new Date("2026-11-11T06:00:00.000Z");
const VALID_P256DH = Buffer.alloc(65, 5).toString("base64url");
const VALID_AUTH = Buffer.alloc(16, 9).toString("base64url");

async function resetTestDb() {
  branchCatalogCache.clear();
  await adminTestPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "notification_deliveries",
      "notifications",
      "notification_events",
      "push_subscriptions",
      "token_services",
      "tokens",
      "queue_counters",
      "branch_services",
      "services",
      "customers",
      "business_hours",
      "salon_settings",
      "staff_branch_access",
      "organization_members",
      "role_permissions",
      "staff_roles",
      "branches",
      "audit_logs",
      "organizations",
      "users"
    CASCADE;
  `);
}

async function seedSalon(prefix: string) {
  let verifyTok = "";
  const reg = await registerSalonOrganization({
    input: {
      ownerName: `Owner ${prefix}`,
      email: `owner-${prefix}@salonflow.test`,
      password: "Password@123",
      organizationName: `Push Studio ${prefix}`,
      salonSlug: `${prefix}-push`,
      branchName: "Main Branch",
      branchSlug: "main",
      timezone: "Asia/Kolkata",
      website: "",
    },
    client: runtimePrisma,
    onVerificationTokenCreated: ({ token }) => {
      verifyTok = token;
    },
  });
  await verifyEmailToken({ token: verifyTok, client: runtimePrisma });

  const ownerClaims: SessionUserClaims = {
    id: reg.userId,
    email: `owner-${prefix}@salonflow.test`,
    name: `Owner ${prefix}`,
    activeOrganizationId: reg.organizationId,
    sessionVersion: 1,
    isPlatformAdmin: false,
  };

  const svc = await createOrganizationService(
    await authorizeTenantAction({
      session: ownerClaims,
      requiredPermission: "SERVICE_MANAGE",
      client: runtimePrisma,
    }),
    {
      name: "Haircut",
      basePriceInPaise: 30000,
      baseDurationMinutes: 30,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  return {
    organizationId: reg.organizationId,
    organizationSlug: `${prefix}-push`,
    branch1Id: reg.branchId,
    branch1Slug: "main",
    ownerClaims,
    serviceId: svc.id,
  };
}

describe("Phase 11 Transactional Outbox & Web Push Notification Suite", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("NT-01 & NT-02 & NT-04: decouples token validity from 503 push failure, cleans up 410 Gone devices, and dead-letters after 5 retries", async () => {
    const salon = await seedSalon("nt1");
    const ownerCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      client: runtimePrisma,
    });

    const dev1 = await upsertOwnerPushSubscription(
      ownerCtx,
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/owner-device-1",
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        deviceLabel: "Desk Chrome",
        preferences: { newToken: true, longQueue: true, testAlerts: true },
      },
      { client: runtimePrisma },
    );

    const dev2 = await upsertOwnerPushSubscription(
      ownerCtx,
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/owner-device-2",
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        deviceLabel: "Old Android",
        preferences: { newToken: true, longQueue: true, testAlerts: true },
      },
      { client: runtimePrisma },
    );

    // NT-01: Push service returns 503 -> token creation STILL succeeds & event schedules RETRYING
    const failing503Transport: PushTransport = {
      send: async () => ({
        ok: false,
        statusCode: 503,
        errorCode: "HTTP_503",
        errorMessage: "Service Unavailable",
        retryable: true,
        durationMs: 12,
      }),
    };

    const tokenRes = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "Nikhil",
      mobileNumber: "9876500101",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(tokenRes.token.tokenNumber).toBe("A001");

    const batch1 = await runNotificationOutboxBatch({
      transport: failing503Transport,
      now: OPEN_NOW,
      enableJitter: false,
      client: runtimePrisma,
    });
    expect(batch1.claimed).toBe(1);
    expect(batch1.retrying).toBe(1);

    const outboxEvent = await adminTestPrisma.notificationEvent.findFirstOrThrow({
      where: { organizationId: salon.organizationId },
    });
    expect(outboxEvent.status).toBe("RETRYING");
    expect(outboxEvent.attemptCount).toBe(1);
    expect(outboxEvent.nextAttemptAt?.getTime()).toBe(OPEN_NOW.getTime() + 15_000);

    // NT-02: On retry, Device 1 succeeds (201) & Device 2 returns 410 Gone -> Device 2 deactivates!
    const mixedTransport: PushTransport = {
      send: async (req) => {
        if (req.subscription.endpoint.includes("owner-device-2")) {
          return {
            ok: false,
            statusCode: 410,
            errorCode: "SUBSCRIPTION_GONE",
            errorMessage: "Gone",
            permanentUnsubscribe: true,
            durationMs: 9,
          };
        }
        return { ok: true, statusCode: 201, durationMs: 14 };
      },
    };

    const retryAt = new Date(OPEN_NOW.getTime() + 16_000);
    const batch2 = await runNotificationOutboxBatch({
      transport: mixedTransport,
      now: retryAt,
      enableJitter: false,
      client: runtimePrisma,
    });
    expect(batch2.processed).toBe(1);
    expect(batch2.deliveriesSucceeded).toBe(1);
    expect(batch2.subscriptionsExpired).toBe(1);

    const sub1After = await adminTestPrisma.pushSubscription.findUniqueOrThrow({
      where: { id: dev1.id },
    });
    const sub2After = await adminTestPrisma.pushSubscription.findUniqueOrThrow({
      where: { id: dev2.id },
    });
    expect(sub1After.isActive).toBe(true);
    expect(sub2After.isActive).toBe(false);
    expect(sub2After.revokedReason).toBe("PROVIDER_EXPIRED");

    // NT-04: Test push exhausted across 5 attempts -> DEAD_LETTER, then manual retry succeeds!
    const testDispatch = await triggerOwnerTestPush(ownerCtx, {
      transport: failing503Transport,
      now: retryAt,
      client: runtimePrisma,
    });
    expect(testDispatch.summary.retrying).toBe(1);

    let cursorMs = retryAt.getTime();
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      cursorMs += 1_000_000;
      await runNotificationOutboxBatch({
        transport: failing503Transport,
        now: new Date(cursorMs),
        enableJitter: false,
        client: runtimePrisma,
      });
    }

    const deadEvent = await adminTestPrisma.notificationEvent.findUniqueOrThrow({
      where: { id: testDispatch.eventId },
    });
    expect(deadEvent.status).toBe("DEAD_LETTER");
    expect(deadEvent.attemptCount).toBe(5);

    const logs = await listOwnerNotifications(ownerCtx, { client: runtimePrisma });
    const deadLog = logs.find((l) => l.notificationEventId === testDispatch.eventId);
    expect(deadLog?.status).toBe("DEAD_LETTER");

    // Manual retry succeeds cleanly with 201 transport
    const retryOk = await retryOwnerNotification(ownerCtx, deadLog!.id, {
      transport: {
        send: async () => ({ ok: true, statusCode: 201, durationMs: 8 }),
      },
      now: new Date(cursorMs + 1000),
      client: runtimePrisma,
    });
    expect(retryOk.summary.processed).toBe(1);
    expect(retryOk.summary.deliveriesSucceeded).toBe(1);
  });

  it("NT-05: two concurrent SKIP LOCKED outbox workers dispatch 10 pending events exactly once each", async () => {
    const salon = await seedSalon("nt5");
    const ownerCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      client: runtimePrisma,
    });

    await upsertOwnerPushSubscription(
      ownerCtx,
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/worker-test-dev",
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        deviceLabel: "Worker Dev",
        preferences: { newToken: true, longQueue: true, testAlerts: true },
      },
      { client: runtimePrisma },
    );

    // Enqueue 10 pending events cleanly inside tenant DB
    await withTenantDb(
      salon.organizationId,
      async (tx) => {
        for (let i = 1; i <= 10; i += 1) {
          await tx.notificationEvent.create({
            data: {
              organizationId: salon.organizationId,
              branchId: salon.branch1Id,
              eventType: "OWNER_TEST_PUSH",
              idempotencyKey: `batch-ev-${i}`,
              status: "PENDING",
              payload: {
                recipientUserId: salon.ownerClaims.id,
                targetUrl: "/owner/settings/notifications",
              },
            },
          });
        }
      },
      runtimePrisma,
    );

    const dispatchedNotificationIds: string[] = [];
    const trackingTransport: PushTransport = {
      send: async (req) => {
        if (req.payload.notificationId) {
          dispatchedNotificationIds.push(req.payload.notificationId);
        }
        return { ok: true, statusCode: 201, durationMs: 5 };
      },
    };

    const [w1, w2] = await Promise.all([
      runNotificationOutboxBatch({
        batchSize: 6,
        workerId: "worker-A",
        transport: trackingTransport,
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
      runNotificationOutboxBatch({
        batchSize: 6,
        workerId: "worker-B",
        transport: trackingTransport,
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    ]);

    expect(w1.claimed + w2.claimed).toBe(10);
    expect(w1.processed + w2.processed).toBe(10);
    expect(dispatchedNotificationIds).toHaveLength(10);
    expect(new Set(dispatchedNotificationIds).size).toBe(10);
  });

  it("NT-06: stops delivering notifications immediately when staff access is revoked or assigned to a different branch", async () => {
    const salon = await seedSalon("nt6");
    const branch2 = await createBranch(
      await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "BRANCH_MANAGE",
        client: runtimePrisma,
      }),
      { name: "Branch Two", slug: "two", timezone: "Asia/Kolkata" },
      { client: runtimePrisma },
    );

    const staffRole = await adminTestPrisma.staffRole.findFirstOrThrow({
      where: { organizationId: salon.organizationId, slug: "STAFF" },
    });

    // Staff A assigned ONLY to branch 1; Staff B assigned ONLY to branch 2
    const invA = await createStaffInvite(
      await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "STAFF_MANAGE",
        client: runtimePrisma,
      }),
      {
        email: "staff-a@salonflow.test",
        name: "Staff A",
        roleId: staffRole.id,
        allBranches: false,
        branchIds: [salon.branch1Id],
      },
      { client: runtimePrisma },
    );
    await acceptStaffInvite(
      invA.invitePath.replace("/invite/", ""),
      { name: "Staff A", password: "Password@123" },
      { client: runtimePrisma },
    );
    const userA = await adminTestPrisma.user.findUniqueOrThrow({
      where: { email: "staff-a@salonflow.test" },
    });
    const memberA = await adminTestPrisma.organizationMember.findFirstOrThrow({
      where: { organizationId: salon.organizationId, userId: userA.id },
    });

    const invB = await createStaffInvite(
      await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "STAFF_MANAGE",
        client: runtimePrisma,
      }),
      {
        email: "staff-b@salonflow.test",
        name: "Staff B",
        roleId: staffRole.id,
        allBranches: false,
        branchIds: [branch2.id],
      },
      { client: runtimePrisma },
    );
    await acceptStaffInvite(
      invB.invitePath.replace("/invite/", ""),
      { name: "Staff B", password: "Password@123" },
      { client: runtimePrisma },
    );
    const userB = await adminTestPrisma.user.findUniqueOrThrow({
      where: { email: "staff-b@salonflow.test" },
    });

    const ctxA = await authorizeTenantAction({
      session: {
        id: userA.id,
        email: userA.email,
        name: userA.name,
        activeOrganizationId: salon.organizationId,
        sessionVersion: 1,
        isPlatformAdmin: false,
      },
      client: runtimePrisma,
    });
    const ctxB = await authorizeTenantAction({
      session: {
        id: userB.id,
        email: userB.email,
        name: userB.name,
        activeOrganizationId: salon.organizationId,
        sessionVersion: 1,
        isPlatformAdmin: false,
      },
      client: runtimePrisma,
    });

    await upsertOwnerPushSubscription(
      ctxA,
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/staff-a-device",
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        preferences: { newToken: true, longQueue: true, testAlerts: true },
      },
      { client: runtimePrisma },
    );
    await upsertOwnerPushSubscription(
      ctxB,
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/staff-b-device",
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        preferences: { newToken: true, longQueue: true, testAlerts: true },
      },
      { client: runtimePrisma },
    );

    // Revoke Staff A immediately
    await revokeStaffMember(
      await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "STAFF_MANAGE",
        client: runtimePrisma,
      }),
      memberA.id,
      { client: runtimePrisma },
    );

    // Trigger new customer token at Branch 1
    await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "Walk Customer",
      mobileNumber: "9899112233",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const sentEndpoints: string[] = [];
    const batch = await runNotificationOutboxBatch({
      transport: {
        send: async (req) => {
          sentEndpoints.push(req.subscription.endpoint);
          return { ok: true, statusCode: 201, durationMs: 5 };
        },
      },
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    // Neither revoked Staff A nor Branch-2-only Staff B receives Branch 1 notification
    expect(batch.processed).toBe(1);
    expect(sentEndpoints).toHaveLength(0);
  });
});
