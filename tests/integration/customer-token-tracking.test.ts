import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { jsonWithEtag } from "@/lib/http";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { branchCatalogCache } from "@/server/cache/branch-catalog-cache";
import { withBranchDb } from "@/server/db";
import { createOrganizationService } from "@/server/services/catalog-service";
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
  cancelPublicToken,
  getPublicTokenTracking,
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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 9 tests",
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
      organizationName: `Track Studio ${prefix}`,
      salonSlug: `${prefix}-track`,
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
    organizationSlug: `${prefix}-track`,
    branchId: reg.branchId,
    branchSlug: "main",
    ownerClaims,
    serviceId: svc.id,
  };
}

describe("Phase 9 Customer Token Tracking & Self-Cancellation Suite", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("IT-PUB-03 & TI-06: exposes masked mobile, isolates sibling customers & tenants, returns 304 ETag, and links skipped re-queues", async () => {
    const salonA = await seedSalon("trk1");
    const salonB = await seedSalon("trk2");

    const t1 = await createPublicToken({
      salonSlug: salonA.organizationSlug,
      branchSlug: salonA.branchSlug,
      fullName: "First Customer",
      mobileNumber: "9876501111",
      serviceIds: [salonA.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    const t2 = await createPublicToken({
      salonSlug: salonA.organizationSlug,
      branchSlug: salonA.branchSlug,
      fullName: "Second Secret Customer",
      mobileNumber: "9876543210",
      serviceIds: [salonA.serviceId],
      now: new Date(OPEN_NOW.getTime() + 1000),
      client: runtimePrisma,
    });

    const tracking2 = await getPublicTokenTracking({
      publicId: t2.token.publicId,
      salonSlug: salonA.organizationSlug,
      branchSlug: salonA.branchSlug,
      now: new Date(OPEN_NOW.getTime() + 2000),
      client: runtimePrisma,
    });

    expect(tracking2.tokenNumber).toBe("A002");
    expect(tracking2.maskedMobile).toBe("******3210");
    expect(tracking2.queuePosition).toBe(2);
    expect(tracking2.peopleAhead).toBe(1);
    expect(tracking2.estimatedWaitMinutes).toBe(30);
    expect(tracking2.canCustomerCancel).toBe(true);

    // TI-06: Raw mobile and sibling customers never appear in response payload
    const serialized = JSON.stringify(tracking2);
    expect(serialized).not.toContain("9876543210");
    expect(serialized).not.toContain("9876501111");
    expect(serialized).not.toContain("First Customer");
    expect(serialized).not.toContain(t1.token.publicId);

    // ETag + 304 check
    const res200 = jsonWithEtag(new Headers(), tracking2, "req_1");
    expect(res200.status).toBe(200);
    const etag = res200.headers.get("etag") ?? "";
    const res304 = jsonWithEtag(
      new Headers({ "if-none-match": etag }),
      tracking2,
      "req_2",
    );
    expect(res304.status).toBe(304);

    // TI-06: Cross-tenant vanity URL mismatch or unknown publicId throws 404
    await expect(
      getPublicTokenTracking({
        publicId: t2.token.publicId,
        salonSlug: salonB.organizationSlug,
        branchSlug: salonB.branchSlug,
        client: runtimePrisma,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      getPublicTokenTracking({
        publicId: "unknown_token_id_1234",
        client: runtimePrisma,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Re-queue link propagation when staff calls & skips t1
    const staffCtx = await authorizeTenantAction({
      session: salonA.ownerClaims,
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: salonA.branchId,
      client: runtimePrisma,
    });
    const called1 = await callNextToken(staffCtx, salonA.branchId, {
      now: new Date(OPEN_NOW.getTime() + 60_000),
      client: runtimePrisma,
    });
    await transitionBranchToken({
      organizationId: salonA.organizationId,
      branchId: salonA.branchId,
      tokenId: called1.token.id,
      action: "SKIP",
      actorType: "STAFF",
      actorId: salonA.ownerClaims.id,
      now: new Date(OPEN_NOW.getTime() + 120_000),
      client: runtimePrisma,
    });
    const requeued = await requeueSkippedToken(
      staffCtx,
      salonA.branchId,
      called1.token.id,
      { now: new Date(OPEN_NOW.getTime() + 180_000), client: runtimePrisma },
    );

    const skippedTracking = await getPublicTokenTracking({
      publicId: t1.token.publicId,
      client: runtimePrisma,
    });
    expect(skippedTracking.status).toBe("SKIPPED");
    expect(skippedTracking.requeuedTo).toEqual({
      publicId: requeued.requeuedToken.publicId,
      tokenNumber: "A003",
      url: `/salon/${salonA.organizationSlug}/${salonA.branchSlug}/token/${requeued.requeuedToken.publicId}`,
    });
  });

  it("IT-PUB-05: allows customer self-cancel ONLY in WAITING with allowCustomerCancel=true, blocking CALLED/IN_SERVICE and disabled branches", async () => {
    const salon = await seedSalon("cancel");

    const tWait = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Cancel Me",
      mobileNumber: "9812345678",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const cancelled = await cancelPublicToken({
      publicId: tWait.token.publicId,
      reason: "Running late",
      ipAddressHash: "hash_123",
      now: new Date(OPEN_NOW.getTime() + 30_000),
      client: runtimePrisma,
    });

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.canCustomerCancel).toBe(false);

    const auditRow = await adminTestPrisma.auditLog.findFirst({
      where: {
        organizationId: salon.organizationId,
        action: "TOKEN_CANCELLED",
        actorType: "CUSTOMER",
      },
    });
    expect(auditRow).not.toBeNull();

    // Token A002 gets CALLED -> self-cancel must return 409 SELF_CANCEL_NOT_ALLOWED
    const tCalled = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Already Called",
      mobileNumber: "9812345679",
      serviceIds: [salon.serviceId],
      now: new Date(OPEN_NOW.getTime() + 60_000),
      client: runtimePrisma,
    });

    const staffCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: salon.branchId,
      client: runtimePrisma,
    });
    await callNextToken(staffCtx, salon.branchId, {
      now: new Date(OPEN_NOW.getTime() + 90_000),
      client: runtimePrisma,
    });

    await expect(
      cancelPublicToken({
        publicId: tCalled.token.publicId,
        now: new Date(OPEN_NOW.getTime() + 95_000),
        client: runtimePrisma,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SELF_CANCEL_NOT_ALLOWED",
    });

    // Disabled allowCustomerCancel must return 403 FORBIDDEN even while WAITING
    await withBranchDb(
      salon.organizationId,
      salon.branchId,
      async (tx) => {
        await tx.salonSettings.updateMany({
          where: { organizationId: salon.organizationId, branchId: salon.branchId },
          data: { allowCustomerCancel: false },
        });
      },
      runtimePrisma,
    );

    const tNoSelfCancel = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Policy Locked",
      mobileNumber: "9812345680",
      serviceIds: [salon.serviceId],
      now: new Date(OPEN_NOW.getTime() + 120_000),
      client: runtimePrisma,
    });

    const lockedView = await getPublicTokenTracking({
      publicId: tNoSelfCancel.token.publicId,
      client: runtimePrisma,
    });
    expect(lockedView.canCustomerCancel).toBe(false);

    await expect(
      cancelPublicToken({
        publicId: tNoSelfCancel.token.publicId,
        now: new Date(OPEN_NOW.getTime() + 125_000),
        client: runtimePrisma,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
  });
});
