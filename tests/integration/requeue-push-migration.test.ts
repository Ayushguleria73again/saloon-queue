import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { runNotificationOutboxBatch } from "@/server/notifications/outbox-worker";
import type {
  PushSendRequest,
  PushTransport,
} from "@/server/notifications/web-push-adapter";
import { updateBranch } from "@/server/services/branch-service";
import { createOrganizationService } from "@/server/services/catalog-service";
import { upsertCustomerPushSubscription } from "@/server/services/customer-notification-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import {
  callNextToken,
  requeueSkippedToken,
  transitionBranchToken,
} from "@/server/services/queue-service";
import { createPublicToken } from "@/server/services/token-service";
import {
  getPublicTokenTracking,
  resolvePublicTokenScope,
} from "@/server/services/token-tracking-service";

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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run integration tests",
  );
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

const OPEN_NOW = new Date("2026-11-13T09:00:00.000Z");
const VALID_P256DH =
  "BOr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VALID_AUTH = "AAAAAAAAAAAAAAAAAAAAAA";

async function truncateAllTables() {
  await adminTestPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "notification_deliveries",
      "notifications",
      "notification_events",
      "push_subscriptions",
      "token_services",
      "tokens",
      "queue_counters",
      "customers",
      "branch_services",
      "services",
      "business_hours",
      "salon_settings",
      "staff_branch_access",
      "organization_members",
      "staff_roles",
      "branches",
      "organizations",
      "users",
      "audit_logs"
    CASCADE
  `);
}

async function seedSalonWithBranch(prefix: string) {
  const lower = prefix.toLowerCase();
  let verifyTok = "";
  const reg = await registerSalonOrganization({
    input: {
      ownerName: `Owner ${prefix}`,
      email: `owner-${lower}@salon.test`,
      password: "StrongPassword!123",
      organizationName: `${prefix} Salon`,
      salonSlug: `${lower}-salon`,
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
    email: `owner-${lower}@salon.test`,
    name: `Owner ${prefix}`,
    isPlatformAdmin: false,
    sessionVersion: 1,
    activeOrganizationId: reg.organizationId,
  };

  const serviceCtx = await authorizeTenantAction({
    session: ownerClaims,
    requiredPermission: "SERVICE_MANAGE",
    client: runtimePrisma,
  });

  const haircut = await createOrganizationService(
    serviceCtx,
    {
      name: "Hair Styling",
      baseDurationMinutes: 20,
      basePriceInPaise: 25000,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  await updateBranch(
    await authorizeTenantAction({
      session: ownerClaims,
      requiredPermission: "BRANCH_MANAGE",
      client: runtimePrisma,
    }),
    reg.branchId,
    {
      settings: {
        activeStationsCount: 1,
        estimatedBufferMinutes: 0,
      },
    },
    { now: OPEN_NOW, client: runtimePrisma },
  );

  return {
    organizationId: reg.organizationId,
    organizationSlug: `${lower}-salon`,
    branchId: reg.branchId,
    branchSlug: "main",
    serviceId: haircut.id,
    ownerClaims,
  };
}

describe("Bug Hunt: Skipped Re-queue Push Migration & Endpoint Deduplication Suite", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("BUG-01: automatically migrates customer push subscriptions to the new token on re-queue and delivers TOKEN_REQUEUED and TOKEN_CALLED", async () => {
    const salon = await seedSalonWithBranch("RequeueBug");

    // 1. Customer issues token A001
    const createdA001 = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Ananya Sharma",
      mobileNumber: "9876543210",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const scopeA001 = await resolvePublicTokenScope(
      createdA001.token.publicId,
      runtimePrisma,
    );

    // 2. Customer opts into Web Push on A001
    const customerEndpoint =
      "https://fcm.googleapis.com/fcm/send/customer-device-token-1";
    await upsertCustomerPushSubscription({
      publicId: createdA001.token.publicId,
      input: {
        endpoint: customerEndpoint,
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        deviceLabel: "Chrome on Android",
      },
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const trackingBeforeSkip = await getPublicTokenTracking({
      publicId: createdA001.token.publicId,
      client: runtimePrisma,
    });
    expect(trackingBeforeSkip.pushAlertsEnabled).toBe(true);

    // 3. Staff calls A001
    const callCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: salon.branchId,
      client: runtimePrisma,
    });

    const called = await callNextToken(callCtx, salon.branchId, {
      now: new Date(OPEN_NOW.getTime() + 60_000),
      client: runtimePrisma,
    });
    expect(called.token.tokenNumber).toBe("A001");

    // 4. Staff skips A001
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: scopeA001.id,
      action: "SKIP",
      actorType: "OWNER",
      actorId: salon.ownerClaims.id,
      now: new Date(OPEN_NOW.getTime() + 120_000),
      client: runtimePrisma,
    });

    // Verify original subscription is now closed
    const originalSub = await adminTestPrisma.pushSubscription.findFirst({
      where: { tokenId: scopeA001.id },
    });
    expect(originalSub?.isActive).toBe(false);
    expect(originalSub?.revokedReason).toBe("TOKEN_CLOSED");

    // 5. Staff re-queues the skipped A001 token
    const requeueResult = await requeueSkippedToken(
      callCtx,
      salon.branchId,
      scopeA001.id,
      {
        now: new Date(OPEN_NOW.getTime() + 180_000),
        client: runtimePrisma,
      },
    );

    const newTokenPublicId = requeueResult.requeuedToken.publicId;
    const newTokenId = requeueResult.requeuedToken.id;

    // 6. Verification of Bug 1:
    // The new token MUST have an active cloned push subscription so push alerts work seamlessly
    const newSub = await adminTestPrisma.pushSubscription.findFirst({
      where: {
        tokenId: newTokenId,
        isActive: true,
      },
    });
    expect(
      newSub,
      "Expected push subscription to be cloned to the re-queued token",
    ).not.toBeNull();
    expect(newSub?.endpoint).toBe(customerEndpoint);
    expect(newSub?.subscriberType).toBe("CUSTOMER");

    // Public tracking page for the new token must show push alerts are enabled
    const newTracking = await getPublicTokenTracking({
      publicId: newTokenPublicId,
      client: runtimePrisma,
    });
    expect(newTracking.pushAlertsEnabled).toBe(true);

    // 7. Verify outbox worker delivers TOKEN_REQUEUED to customer device
    const deliveredRequests: PushSendRequest[] = [];
    const mockTransport: PushTransport = {
      send: async (req) => {
        deliveredRequests.push(req);
        return { ok: true, statusCode: 201, durationMs: 12 };
      },
    };

    const outboxBatch1 = await runNotificationOutboxBatch({
      batchSize: 10,
      transport: mockTransport,
      now: new Date(OPEN_NOW.getTime() + 190_000),
      client: runtimePrisma,
    });

    expect(outboxBatch1.deliveriesSucceeded).toBeGreaterThanOrEqual(1);
    const requeuePush = deliveredRequests.find(
      (r) =>
        r.subscription.endpoint === customerEndpoint &&
        r.payload.tag === `requeued-${newTokenId}`,
    );
    expect(
      requeuePush,
      "TOKEN_REQUEUED push notification must be delivered to customer endpoint",
    ).toBeDefined();

    // 8. Staff calls the re-queued token when its turn arrives
    await callNextToken(callCtx, salon.branchId, {
      now: new Date(OPEN_NOW.getTime() + 240_000),
      client: runtimePrisma,
    });

    const outboxBatch2 = await runNotificationOutboxBatch({
      batchSize: 10,
      transport: mockTransport,
      now: new Date(OPEN_NOW.getTime() + 250_000),
      client: runtimePrisma,
    });

    expect(outboxBatch2.deliveriesSucceeded).toBeGreaterThanOrEqual(1);
    const calledPush = deliveredRequests.find(
      (r) =>
        r.subscription.endpoint === customerEndpoint &&
        r.payload.tag === `token-called-${newTokenId}`,
    );
    expect(
      calledPush,
      "TOKEN_CALLED push notification must be delivered to customer endpoint",
    ).toBeDefined();
  });

  it("BUG-02: deduplicates subscriptions sharing identical device endpoint so only 1 push is dispatched per device", async () => {
    const salon = await seedSalonWithBranch("DedupeBug");

    // Add a second staff member in this organization
    const staffUser = await adminTestPrisma.user.create({
      data: {
        email: "staff-dedupe@salon.test",
        passwordHash: "hash123",
        name: "Staff Member",
        emailVerifiedAt: OPEN_NOW,
      },
    });

    // Find existing role in this organization
    const role = await adminTestPrisma.staffRole.findFirstOrThrow({
      where: { organizationId: salon.organizationId },
    });

    // Add organization member for staff
    await adminTestPrisma.organizationMember.create({
      data: {
        organizationId: salon.organizationId,
        userId: staffUser.id,
        staffRoleId: role.id,
        status: "ACTIVE",
        allBranches: true,
      },
    });

    const sharedEndpoint =
      "https://fcm.googleapis.com/fcm/send/shared-physical-device-xyz";

    // Both owner and staff are subscribed using the SAME shared tablet endpoint
    await adminTestPrisma.pushSubscription.createMany({
      data: [
        {
          organizationId: salon.organizationId,
          branchId: salon.branchId,
          subscriberType: "OWNER_STAFF",
          userId: salon.ownerClaims.id,
          endpoint: sharedEndpoint,
          p256dh: VALID_P256DH,
          auth: VALID_AUTH,
          deviceLabel: "Front Desk Tablet (Owner)",
          isActive: true,
        },
        {
          organizationId: salon.organizationId,
          branchId: salon.branchId,
          subscriberType: "OWNER_STAFF",
          userId: staffUser.id,
          endpoint: sharedEndpoint,
          p256dh: VALID_P256DH,
          auth: VALID_AUTH,
          deviceLabel: "Front Desk Tablet (Staff)",
          isActive: true,
        },
      ],
    });

    // Create a new token to trigger owner/staff alert
    await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Rohan Patel",
      mobileNumber: "9876543211",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    // Process outbox with mock transport
    const sendsToEndpoint: PushSendRequest[] = [];
    const mockTransport: PushTransport = {
      send: async (req) => {
        if (req.subscription.endpoint === sharedEndpoint) {
          sendsToEndpoint.push(req);
        }
        return { ok: true, statusCode: 201, durationMs: 10 };
      },
    };

    await runNotificationOutboxBatch({
      batchSize: 10,
      transport: mockTransport,
      now: new Date(OPEN_NOW.getTime() + 70_000),
      client: runtimePrisma,
    });

    // The shared physical device must receive EXACTLY ONE push delivery, not duplicate alerts!
    expect(sendsToEndpoint.length).toBe(1);
  });
});
