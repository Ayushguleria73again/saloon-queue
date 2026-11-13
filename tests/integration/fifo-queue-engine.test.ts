import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { branchCatalogCache } from "@/server/cache/branch-catalog-cache";
import { createBranch } from "@/server/services/branch-service";
import { createOrganizationService } from "@/server/services/catalog-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import {
  callNextToken,
  createWalkInToken,
  getBranchQueueOverview,
  getBranchTokenHistory,
  requeueSkippedToken,
  transitionBranchToken,
} from "@/server/services/queue-service";
import { acceptStaffInvite, createStaffInvite } from "@/server/services/staff-service";
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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 8 tests",
  );
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

// Wednesday 2026-11-11T06:00:00.000Z === 11:30 AM IST (open: 09:30..21:30).
const OPEN_NOW = new Date("2026-11-11T06:00:00.000Z");

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

async function seedSalonForQueue(prefix: string) {
  let verifyTok = "";
  const reg = await registerSalonOrganization({
    input: {
      ownerName: `Owner ${prefix}`,
      email: `owner-${prefix}@salonflow.test`,
      password: "Password@123",
      organizationName: `Queue Studio ${prefix}`,
      salonSlug: `${prefix}-queue`,
      branchName: "Main Branch",
      branchSlug: "main",
      timezone: "Asia/Kolkata",
      city: "Bengaluru",
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

  const branch2 = await createBranch(
    await authorizeTenantAction({
      session: ownerClaims,
      requiredPermission: "BRANCH_MANAGE",
      client: runtimePrisma,
    }),
    {
      name: "West Branch",
      slug: "west",
      timezone: "Asia/Kolkata",
    },
    { client: runtimePrisma },
  );

  const haircut = await createOrganizationService(
    await authorizeTenantAction({
      session: ownerClaims,
      requiredPermission: "SERVICE_MANAGE",
      client: runtimePrisma,
    }),
    {
      name: "Signature Cut",
      basePriceInPaise: 35000,
      baseDurationMinutes: 30,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  return {
    organizationId: reg.organizationId,
    organizationSlug: `${prefix}-queue`,
    ownerClaims,
    branch1Id: reg.branchId,
    branch1Slug: "main",
    branch2Id: branch2.id,
    serviceId: haircut.id,
  };
}

describe("Phase 8 FIFO Queue Management Engine & Concurrency Suite", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("IT-QUE-01 & IT-QUE-02: manages walk-in creation, Call Next FIFO order, approaching outbox, skipped re-queue, branch isolation, and KPI overview", async () => {
    const salon = await seedSalonForQueue("que1");

    // 1. Invite Staff scoped ONLY to branch1
    const staffRole = await adminTestPrisma.staffRole.findFirstOrThrow({
      where: { organizationId: salon.organizationId, slug: "STAFF" },
    });
    const invited = await createStaffInvite(
      await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "STAFF_MANAGE",
        client: runtimePrisma,
      }),
      {
        email: "stylist1@salonflow.test",
        name: "Stylist One",
        roleId: staffRole.id,
        allBranches: false,
        branchIds: [salon.branch1Id],
      },
      { client: runtimePrisma },
    );
    const rawInviteToken = invited.invitePath.replace("/invite/", "");
    const accepted = await acceptStaffInvite(
      rawInviteToken,
      { name: "Stylist One", password: "Password@123" },
      { client: runtimePrisma },
    );
    const staffUser = await adminTestPrisma.user.findUniqueOrThrow({
      where: { email: accepted.email },
      select: { id: true },
    });

    const staffClaims: SessionUserClaims = {
      id: staffUser.id,
      email: accepted.email,
      name: "Stylist One",
      activeOrganizationId: salon.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };

    // Staff cannot manage staff or touch branch2 queue
    await expect(
      authorizeTenantAction({
        session: staffClaims,
        requiredPermission: "STAFF_MANAGE",
        client: runtimePrisma,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      authorizeTenantAction({
        session: staffClaims,
        requiredPermission: "QUEUE_CALL_NEXT",
        branchId: salon.branch2Id,
        client: runtimePrisma,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "BRANCH_ACCESS_DENIED" });

    // 2. Create 2 QR tokens + 1 Walk-In + 2 more QR tokens -> A001..A005 FIFO
    await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "Cust One",
      mobileNumber: "9810000001",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "Cust Two",
      mobileNumber: "9810000002",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    const walkIn = await createWalkInToken(
      await authorizeTenantAction({
        session: staffClaims,
        requiredPermission: "QUEUE_CREATE_WALKIN",
        branchId: salon.branch1Id,
        client: runtimePrisma,
      }),
      salon.branch1Id,
      {
        fullName: "WalkIn Three",
        mobileNumber: "9810000003",
        serviceIds: [salon.serviceId],
      },
      { now: OPEN_NOW, client: runtimePrisma },
    );
    expect(walkIn.token.tokenNumber).toBe("A003");
    expect(walkIn.isIdempotentReplay).toBe(false);

    const t4 = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "Cust Four",
      mobileNumber: "9810000004",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    const t5 = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "Cust Five",
      mobileNumber: "9810000005",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(t4.token.tokenNumber).toBe("A004");
    expect(t5.token.tokenNumber).toBe("A005");

    // 3. Staff Call Next -> must call A001 cleanly & enqueue CUSTOMER_CALLED + APPROACHING_3
    const callNextCtx = await authorizeTenantAction({
      session: staffClaims,
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: salon.branch1Id,
      client: runtimePrisma,
    });
    const called1 = await callNextToken(callNextCtx, salon.branch1Id, {
      now: new Date(OPEN_NOW.getTime() + 60_000),
      client: runtimePrisma,
    });
    expect(called1.token.tokenNumber).toBe("A001");
    expect(called1.token.status).toBe("CALLED");

    const approachingOutbox = await adminTestPrisma.notificationEvent.findMany({
      where: {
        branchId: salon.branch1Id,
        eventType: {
          in: ["TOKEN_CALLED", "CUSTOMER_APPROACHING_1", "CUSTOMER_APPROACHING_3"],
        },
      },
    });
    expect(approachingOutbox.some((e) => e.eventType === "TOKEN_CALLED")).toBe(true);
    expect(approachingOutbox.some((e) => e.eventType === "CUSTOMER_APPROACHING_3")).toBe(
      true,
    );

    // 4. Attach active PushSubscription on A001, then transition CALLED -> IN_SERVICE -> COMPLETED
    await adminTestPrisma.pushSubscription.create({
      data: {
        organizationId: salon.organizationId,
        branchId: salon.branch1Id,
        subscriberType: "CUSTOMER",
        tokenId: called1.token.id,
        endpoint: "https://fcm.googleapis.com/fcm/send/a001-sub",
        p256dh: "p256dh_dummy",
        auth: "auth_dummy",
        isActive: true,
      },
    });

    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branch1Id,
      tokenId: called1.token.id,
      action: "START_SERVICE",
      actorType: "STAFF",
      actorId: staffClaims.id,
      now: new Date(OPEN_NOW.getTime() + 5 * 60_000),
      client: runtimePrisma,
    });
    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branch1Id,
      tokenId: called1.token.id,
      action: "COMPLETE",
      actorType: "STAFF",
      actorId: staffClaims.id,
      now: new Date(OPEN_NOW.getTime() + 30 * 60_000),
      client: runtimePrisma,
    });

    const deactivatedSub = await adminTestPrisma.pushSubscription.findFirst({
      where: { tokenId: called1.token.id },
    });
    expect(deactivatedSub?.isActive).toBe(false);
    expect(deactivatedSub?.revokedReason).toBe("TOKEN_CLOSED");

    // 5. IT-QUE-02: Call A002 -> SKIP -> Re-queue A002 -> preserves A002 & creates A006 at tail
    const called2 = await callNextToken(callNextCtx, salon.branch1Id, {
      now: new Date(OPEN_NOW.getTime() + 31 * 60_000),
      client: runtimePrisma,
    });
    expect(called2.token.tokenNumber).toBe("A002");

    await transitionBranchToken({
      organizationId: salon.organizationId,
      branchId: salon.branch1Id,
      tokenId: called2.token.id,
      action: "SKIP",
      actorType: "STAFF",
      actorId: staffClaims.id,
      now: new Date(OPEN_NOW.getTime() + 32 * 60_000),
      client: runtimePrisma,
    });

    const requeued = await requeueSkippedToken(
      callNextCtx,
      salon.branch1Id,
      called2.token.id,
      {
        now: new Date(OPEN_NOW.getTime() + 35 * 60_000),
        client: runtimePrisma,
      },
    );
    expect(requeued.originalTokenNumber).toBe("A002");
    expect(requeued.requeuedToken.tokenNumber).toBe("A006");
    expect(requeued.requeuedToken.status).toBe("WAITING");
    expect(requeued.requeuedToken.requeuedFromTokenId).toBe(called2.token.id);
    expect(requeued.requeuedToken.services).toHaveLength(1);

    // Original A002 stays immutable in SKIPPED
    const originalRow = await adminTestPrisma.token.findUniqueOrThrow({
      where: { id: called2.token.id },
    });
    expect(originalRow.status).toBe("SKIPPED");
    expect(originalRow.sequenceNumber).toBe(2);

    // Double re-queue attempt is rejected cleanly
    await expect(
      requeueSkippedToken(callNextCtx, salon.branch1Id, called2.token.id, {
        now: new Date(OPEN_NOW.getTime() + 36 * 60_000),
        client: runtimePrisma,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // 6. Verify Queue Overview KPIs & active FIFO order (A003 Walk-In -> A004 -> A005 -> A006 Re-queue)
    const overview = await getBranchQueueOverview(
      await authorizeTenantAction({
        session: staffClaims,
        requiredPermission: "QUEUE_VIEW",
        branchId: salon.branch1Id,
        client: runtimePrisma,
      }),
      salon.branch1Id,
      { now: new Date(OPEN_NOW.getTime() + 36 * 60_000), client: runtimePrisma },
    );
    expect(overview.waitingTokens.map((t) => t.tokenNumber)).toEqual([
      "A003",
      "A004",
      "A005",
      "A006",
    ]);
    expect(overview.skippedTokens).toHaveLength(0); // A002 already re-queued
    expect(overview.kpis.completedCount).toBe(1);
    expect(overview.kpis.skippedCount).toBe(1);
    expect(overview.kpis.waitingCount).toBe(4);
    expect(overview.kpis.revenueInPaise).toBe(35000);
  });

  it("supports bounded keyset cursor pagination and search filters in branch history", async () => {
    const salon = await seedSalonForQueue("hist");
    const ownerCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "HISTORY_VIEW",
      branchId: salon.branch1Id,
      client: runtimePrisma,
    });

    for (let i = 1; i <= 5; i += 1) {
      await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branch1Slug,
        fullName: i === 4 ? "Zoya Khan" : `Visitor ${i}`,
        mobileNumber: `983330000${i}`,
        serviceIds: [salon.serviceId],
        now: new Date(OPEN_NOW.getTime() + i * 1000),
        client: runtimePrisma,
      });
    }

    const page1 = await getBranchTokenHistory(
      ownerCtx,
      salon.branch1Id,
      { status: "ALL", limit: 2 },
      runtimePrisma,
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await getBranchTokenHistory(
      ownerCtx,
      salon.branch1Id,
      { status: "ALL", limit: 2, cursor: page1.nextCursor ?? undefined },
      runtimePrisma,
    );
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await getBranchTokenHistory(
      ownerCtx,
      salon.branch1Id,
      { status: "ALL", limit: 2, cursor: page2.nextCursor ?? undefined },
      runtimePrisma,
    );
    expect(page3.items).toHaveLength(1);
    expect(page3.hasMore).toBe(false);

    const allNumbers = [...page1.items, ...page2.items, ...page3.items].map(
      (t) => t.tokenNumber,
    );
    expect(new Set(allNumbers)).toEqual(
      new Set(["A001", "A002", "A003", "A004", "A005"]),
    );

    const filtered = await getBranchTokenHistory(
      ownerCtx,
      salon.branch1Id,
      { status: "ALL", search: "Zoya", limit: 10 },
      runtimePrisma,
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.tokenNumber).toBe("A004");
  });

  it("CT-05: simultaneous Call Next calls by two staff never call the same token twice", async () => {
    const salon = await seedSalonForQueue("ct05");

    await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "First Waiting",
      mobileNumber: "9844400001",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "Second Waiting",
      mobileNumber: "9844400002",
      serviceIds: [salon.serviceId],
      now: new Date(OPEN_NOW.getTime() + 1000),
      client: runtimePrisma,
    });

    const staffCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: salon.branch1Id,
      client: runtimePrisma,
    });

    const [r1, r2] = await Promise.all([
      callNextToken(staffCtx, salon.branch1Id, { now: OPEN_NOW, client: runtimePrisma }),
      callNextToken(staffCtx, salon.branch1Id, { now: OPEN_NOW, client: runtimePrisma }),
    ]);

    expect(new Set([r1.token.tokenNumber, r2.token.tokenNumber])).toEqual(
      new Set(["A001", "A002"]),
    );

    await expect(
      callNextToken(staffCtx, salon.branch1Id, { now: OPEN_NOW, client: runtimePrisma }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "NO_WAITING_CUSTOMERS",
    });
  });

  it("CT-06: simultaneous staff Start Service vs customer Cancel commits one and deterministically returns 409 on the other", async () => {
    const salon = await seedSalonForQueue("ct06");

    const created = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1Slug,
      fullName: "Contended Customer",
      mobileNumber: "9855500001",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const tokenRow = await adminTestPrisma.token.findUniqueOrThrow({
      where: { publicId: created.token.publicId },
      select: { id: true },
    });

    const [staffOutcome, customerOutcome] = await Promise.allSettled([
      transitionBranchToken({
        organizationId: salon.organizationId,
        branchId: salon.branch1Id,
        tokenId: tokenRow.id,
        action: "START_SERVICE",
        actorType: "STAFF",
        actorId: salon.ownerClaims.id,
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
      transitionBranchToken({
        organizationId: salon.organizationId,
        branchId: salon.branch1Id,
        tokenId: tokenRow.id,
        action: "CANCEL",
        actorType: "CUSTOMER",
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    ]);

    const outcomes = [staffOutcome, customerOutcome];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConflictError);
    expect(["INVALID_STATE_TRANSITION", "SELF_CANCEL_NOT_ALLOWED"]).toContain(
      (rejected[0]?.reason as ConflictError).code,
    );
  });
});
