import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { withTenantDb } from "@/server/db";
import { runNotificationOutboxBatch } from "@/server/notifications/outbox-worker";
import type { PushTransport } from "@/server/notifications/web-push-adapter";
import { updateBranch } from "@/server/services/branch-service";
import { createOrganizationService } from "@/server/services/catalog-service";
import {
  acknowledgePublicNotification,
  revokeCustomerPushSubscription,
  upsertCustomerPushSubscription,
} from "@/server/services/customer-notification-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import { callNextToken, transitionBranchToken } from "@/server/services/queue-service";
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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 12 integration tests",
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
      name: "Classic Haircut",
      baseDurationMinutes: 30,
      basePriceInPaise: 30000,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  // Use 1 active station and 0 buffer so APPROACHING_3 / APPROACHING_1 map predictably
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

describe("Phase 12 Customer Web Push, Anti-Flap Milestones & Ack Suite", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("NT-03: triggers customer milestones (APPROACHING_3, APPROACHING_1, TOKEN_CALLED) at most once even across queue fluctuations", async () => {
    const salon = await seedSalonWithBranch("Nt03");

    const tokens: Array<{ id: string; publicId: string; tokenNumber: string }> = [];
    for (let i = 1; i <= 5; i += 1) {
      const created = await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: `Customer ${i}`,
        mobileNumber: `987654320${i}`,
        serviceIds: [salon.serviceId],
        now: OPEN_NOW,
        client: runtimePrisma,
      });
      const scope = await resolvePublicTokenScope(created.token.publicId, runtimePrisma);
      tokens.push({
        id: scope.id,
        publicId: created.token.publicId,
        tokenNumber: created.token.tokenNumber,
      });
    }

    const tokenA005 = tokens[4]!;

    // Subscribe A005 post-creation
    await upsertCustomerPushSubscription({
      publicId: tokenA005.publicId,
      input: {
        endpoint: "https://fcm.googleapis.com/fcm/send/a005-device",
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      },
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const sentEvents: string[] = [];
    const mockTransport: PushTransport = {
      send: async (req) => {
        sentEvents.push(req.payload.tag);
        return { ok: true, statusCode: 201, durationMs: 8 };
      },
    };

    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });
    expect(sentEvents.filter((t) => t.startsWith("confirmed-"))).toHaveLength(1);

    const queueCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: salon.branchId,
      client: runtimePrisma,
    });

    // Call A001 -> still 4 active tokens ahead of A005 ([A001 called, A002..A004 waiting])
    await callNextToken(queueCtx, salon.branchId, {
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    // Start A001 -> A001 moves IN_SERVICE; A005 now has peopleAhead = 3 ([A002, A003, A004]) -> APPROACHING_3!
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokens[0]!.id,
      action: "START_SERVICE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });
    expect(sentEvents.filter((t) => t.startsWith("approaching-3-"))).toHaveLength(1);

    // Fluctuate while A005 remains at 3 ahead: Complete A001 & Call A002 -> A005 still has 3 ahead!
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokens[0]!.id,
      action: "COMPLETE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await callNextToken(queueCtx, salon.branchId, {
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });

    // Confirm APPROACHING_3 is STILL only sent once in history!
    expect(sentEvents.filter((t) => t.startsWith("approaching-3-"))).toHaveLength(1);

    // Advance until A005 reaches 1 ahead (A004 called, A005 waiting -> peopleAhead = 1!)
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokens[1]!.id,
      action: "START_SERVICE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokens[1]!.id,
      action: "COMPLETE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await callNextToken(queueCtx, salon.branchId, {
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokens[2]!.id,
      action: "START_SERVICE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await callNextToken(queueCtx, salon.branchId, {
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    // Now A004 is CALLED and A005 is WAITING -> peopleAhead = 1 -> APPROACHING_1 triggers!
    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });
    expect(sentEvents.filter((t) => t.startsWith("approaching-1-"))).toHaveLength(1);

    // Complete A003 & start A004 -> A005 hits 0 ahead (still only 1 APPROACHING_1 total!)
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokens[2]!.id,
      action: "COMPLETE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokens[3]!.id,
      action: "START_SERVICE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });
    expect(sentEvents.filter((t) => t.startsWith("approaching-1-"))).toHaveLength(1);

    // Call Next -> A005 CALLED -> TOKEN_CALLED triggers once!
    const calledA005 = await callNextToken(queueCtx, salon.branchId, {
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(calledA005.token.id).toBe(tokenA005.id);
    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });

    expect(sentEvents.filter((t) => t.startsWith("token-called-"))).toHaveLength(1);

    // Complete A005 -> customer PushSubscription automatically deactivated cleanly
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokenA005.id,
      action: "START_SERVICE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: tokenA005.id,
      action: "COMPLETE",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    await withTenantDb(
      salon.organizationId,
      async (tx) => {
        const sub = await tx.pushSubscription.findFirstOrThrow({
          where: { tokenId: tokenA005.id, subscriberType: "CUSTOMER" },
        });
        expect(sub.isActive).toBe(false);
        expect(sub.revokedReason).toBe("TOKEN_CLOSED");

        const events = await tx.notificationEvent.findMany({
          where: { tokenId: tokenA005.id },
          select: { eventType: true },
        });
        expect(
          events.filter((e) => e.eventType === "CUSTOMER_APPROACHING_3"),
        ).toHaveLength(1);
        expect(
          events.filter((e) => e.eventType === "CUSTOMER_APPROACHING_1"),
        ).toHaveLength(1);
        expect(events.filter((e) => e.eventType === "TOKEN_CALLED")).toHaveLength(1);
      },
      runtimePrisma,
    );
  });

  it("IT-PUB-04: operates 100% cleanly without subscription, handles opt-in, QUEUE_DELAYED pause, SW /ack telemetry, and CUSTOMER_OPT_OUT", async () => {
    const salon = await seedSalonWithBranch("Pub04");

    // 1. Customer without push permission completes full tracking seamlessly
    const noPush = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "No Push User",
      mobileNumber: "9811112222",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const initialTrack = await getPublicTokenTracking({
      publicId: noPush.token.publicId,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(initialTrack.status).toBe("WAITING");
    expect(initialTrack.pushAlertsEnabled).toBe(false);

    // 2. Second customer opts in post-token creation
    const optedIn = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Subscribed User",
      mobileNumber: "9811113333",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    const optedInScope = await resolvePublicTokenScope(
      optedIn.token.publicId,
      runtimePrisma,
    );

    const subResult = await upsertCustomerPushSubscription({
      publicId: optedIn.token.publicId,
      input: {
        endpoint: "https://fcm.googleapis.com/fcm/send/pub04-device",
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      },
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(subResult.subscribed).toBe(true);

    const afterSubTrack = await getPublicTokenTracking({
      publicId: optedIn.token.publicId,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(afterSubTrack.pushAlertsEnabled).toBe(true);

    const capturedNotifIds: string[] = [];
    const capturedTags: string[] = [];
    const mockTransport: PushTransport = {
      send: async (req) => {
        if (req.payload.notificationId) {
          capturedNotifIds.push(req.payload.notificationId);
        }
        capturedTags.push(req.payload.tag);
        return { ok: true, statusCode: 201, durationMs: 5 };
      },
    };

    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });
    expect(capturedNotifIds).toHaveLength(1);

    // 3. Service Worker ack flips Notification -> ACKNOWLEDGED cleanly
    const ackRes = await acknowledgePublicNotification({
      notificationId: capturedNotifIds[0]!,
      event: "DISPLAYED",
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(ackRes).toEqual({ ok: true });

    await withTenantDb(
      salon.organizationId,
      async (tx) => {
        const notif = await tx.notification.findUniqueOrThrow({
          where: { id: capturedNotifIds[0]! },
        });
        expect(notif.status).toBe("ACKNOWLEDGED");
        expect(notif.acknowledgedAt).not.toBeNull();
      },
      runtimePrisma,
    );

    // 4. Pausing queue triggers single hourly QUEUE_DELAYED notification cleanly
    const branchCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "BRANCH_MANAGE",
      client: runtimePrisma,
    });

    await updateBranch(
      branchCtx,
      salon.branchId,
      {
        settings: {
          isAcceptingTokens: false,
          queuePausedReason: "Equipment sterilization break",
        },
      },
      { now: OPEN_NOW, client: runtimePrisma },
    );
    await updateBranch(
      branchCtx,
      salon.branchId,
      {
        settings: {
          isAcceptingTokens: false,
          queuePausedReason: "Equipment sterilization break",
        },
      },
      { now: OPEN_NOW, client: runtimePrisma },
    );

    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });
    expect(capturedTags.filter((tag) => tag.startsWith("delayed-"))).toHaveLength(1);

    // 5. Explicit CUSTOMER_OPT_OUT stops further turn notifications and updates tracking flag
    const revokeRes = await revokeCustomerPushSubscription({
      publicId: optedIn.token.publicId,
      endpoint: "https://fcm.googleapis.com/fcm/send/pub04-device",
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(revokeRes).toEqual({ subscribed: false, revokedCount: 1 });

    const afterOptOutTrack = await getPublicTokenTracking({
      publicId: optedIn.token.publicId,
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(afterOptOutTrack.pushAlertsEnabled).toBe(false);

    // Advance both tokens to completion -> zero new deliveries after opt-out
    const sentCountBeforeAdvance = capturedTags.length;
    const queueCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: salon.branchId,
      client: runtimePrisma,
    });
    await callNextToken(queueCtx, salon.branchId, {
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await callNextToken(queueCtx, salon.branchId, {
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await runNotificationOutboxBatch({ transport: mockTransport, client: runtimePrisma });

    expect(capturedTags.length).toBe(sentCountBeforeAdvance);

    // 6. Terminal token rejects new push opt-in cleanly with TOKEN_CLOSED
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branchId,
      tokenId: optedInScope.id,
      action: "MARK_NO_SHOW",
      actorType: "STAFF",
      actorId: salon.ownerClaims.id,
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    await expect(
      upsertCustomerPushSubscription({
        publicId: optedIn.token.publicId,
        input: {
          endpoint: "https://fcm.googleapis.com/fcm/send/pub04-device-2",
          keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        },
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    ).rejects.toMatchObject({ code: "TOKEN_CLOSED" });
  });
});
