import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, ServiceUnavailableError } from "@/lib/errors";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { branchCatalogCache } from "@/server/cache/branch-catalog-cache";
import { withBranchDb } from "@/server/db";
import { createBranch, updateBranch } from "@/server/services/branch-service";
import {
  createOrganizationService,
  upsertBranchServiceOverride,
} from "@/server/services/catalog-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import { createPublicToken } from "@/server/services/token-service";
import { computeBranchWaitSnapshot } from "@/server/services/wait-time-service";

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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 7 tests",
  );
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

// Provide pool headroom when CT-01/CT-02 fire 25-30 simultaneous transactions.
const runtimePoolUrl = TEST_RUNTIME_URL.includes("connection_limit=")
  ? TEST_RUNTIME_URL
  : `${TEST_RUNTIME_URL}${TEST_RUNTIME_URL.includes("?") ? "&" : "?"}connection_limit=32`;

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: runtimePoolUrl } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

// Wednesday 2026-11-11T06:00:00.000Z === 11:30 AM IST (open: 09:30..21:30).
const OPEN_NOW = new Date("2026-11-11T06:00:00.000Z");
// Wednesday 2026-11-11T17:30:00.000Z === 23:00 PM IST (closed).
const CLOSED_NOW = new Date("2026-11-11T17:30:00.000Z");

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

async function seedSalonWithTwoBranches(slugPrefix: string) {
  let verifyTok = "";
  const reg = await registerSalonOrganization({
    input: {
      ownerName: `Owner ${slugPrefix}`,
      email: `owner-${slugPrefix}@salonflow.test`,
      password: "Password@123",
      organizationName: `Studio ${slugPrefix}`,
      salonSlug: `${slugPrefix}-studio`,
      branchName: "Koramangala",
      branchSlug: "koramangala",
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
    email: `owner-${slugPrefix}@salonflow.test`,
    name: `Owner ${slugPrefix}`,
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
      name: "Indiranagar",
      slug: "indiranagar",
      timezone: "Asia/Kolkata",
      city: "Bengaluru",
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
      name: "Classic Haircut",
      description: "Precision cut",
      basePriceInPaise: 30000,
      baseDurationMinutes: 30,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  const beard = await createOrganizationService(
    await authorizeTenantAction({
      session: ownerClaims,
      requiredPermission: "SERVICE_MANAGE",
      client: runtimePrisma,
    }),
    {
      name: "Beard Styling",
      basePriceInPaise: 20000,
      baseDurationMinutes: 20,
      sortOrder: 2,
    },
    { client: runtimePrisma },
  );

  // Override Haircut price at Branch 1 to ₹350 (35000 paise) for snapshot verification.
  await upsertBranchServiceOverride(
    await authorizeTenantAction({
      session: ownerClaims,
      requiredPermission: "SERVICE_MANAGE",
      branchId: reg.branchId,
      client: runtimePrisma,
    }),
    reg.branchId,
    haircut.id,
    {
      isAvailable: true,
      priceOverrideInPaise: 35000,
      durationOverrideMinutes: 35,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  return {
    organizationId: reg.organizationId,
    organizationSlug: `${slugPrefix}-studio`,
    ownerClaims,
    branch1: { id: reg.branchId, slug: "koramangala" },
    branch2: { id: branch2.id, slug: branch2.slug },
    haircutId: haircut.id,
    beardId: beard.id,
  };
}

describe("Phase 7 Token Generation, Outbox & PostgreSQL Concurrency Suite", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("IT-PUB-01 & IT-PUB-02 & IT-BRN-01: creates atomic token + snapshots + outbox + audit, enforces policies & duplicate guard without PII, and survives post-commit hook failures", async () => {
    const salonA = await seedSalonWithTwoBranches("alpha");
    const salonB = await seedSalonWithTwoBranches("beta");

    // Create first public token at Branch 1 with Haircut (overridden ₹350 / 35m) + Beard (₹200 / 20m)
    const created1 = await createPublicToken({
      salonSlug: salonA.organizationSlug,
      branchSlug: salonA.branch1.slug,
      fullName: "Rahul Sharma",
      mobileNumber: "+91 98765-43210",
      serviceIds: [salonA.haircutId, salonA.beardId],
      notes: "Light taper fade",
      idempotencyKey: crypto.randomUUID(),
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    expect(created1.isIdempotentReplay).toBe(false);
    expect(created1.token.tokenNumber).toBe("A001");
    expect(created1.token.status).toBe("WAITING");
    expect(created1.token.queuePosition).toBe(1);
    expect(created1.token.peopleAhead).toBe(0);
    expect(created1.token.estimatedWaitMinutes).toBe(0);
    expect(created1.token.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(created1.redirectUrl).toBe(
      `/salon/${salonA.organizationSlug}/${salonA.branch1.slug}/token/${created1.token.publicId}`,
    );

    // Inspect committed DB records via adminTestPrisma
    const tokenRow = await adminTestPrisma.token.findUnique({
      where: { publicId: created1.token.publicId },
      include: { tokenServices: true, notificationEvents: true },
    });
    expect(tokenRow).not.toBeNull();
    expect(tokenRow?.totalPriceInPaise).toBe(55000);
    expect(tokenRow?.totalDurationMinutes).toBe(55);
    expect(tokenRow?.tokenServices).toHaveLength(2);
    expect(tokenRow?.notificationEvents).toHaveLength(1);
    expect(tokenRow?.notificationEvents[0]?.eventType).toBe("NEW_TOKEN_OWNER_ALERT");
    expect(tokenRow?.notificationEvents[0]?.status).toBe("PENDING");
    expect(tokenRow?.notificationEvents[0]?.idempotencyKey).toBe(
      `token:${tokenRow?.id}:NEW_TOKEN_OWNER_ALERT`,
    );

    const auditRow = await adminTestPrisma.auditLog.findFirst({
      where: {
        organizationId: salonA.organizationId,
        action: "TOKEN_CREATED",
        entityId: tokenRow?.id,
      },
    });
    expect(auditRow).not.toBeNull();

    // Duplicate active mobile at SAME branch must fail with 409 ACTIVE_TOKEN_EXISTS & zero PII leaked
    let dupErr: unknown = null;
    try {
      await createPublicToken({
        salonSlug: salonA.organizationSlug,
        branchSlug: salonA.branch1.slug,
        fullName: "Someone Else",
        mobileNumber: "9876543210",
        serviceIds: [salonA.haircutId],
        now: OPEN_NOW,
        client: runtimePrisma,
      });
    } catch (err) {
      dupErr = err;
    }
    expect(dupErr).toBeInstanceOf(ConflictError);
    expect((dupErr as ConflictError).code).toBe("ACTIVE_TOKEN_EXISTS");
    expect((dupErr as ConflictError).message).not.toContain("A001");
    expect((dupErr as ConflictError).message).not.toContain("Rahul");
    expect((dupErr as ConflictError).message).not.toContain("9876543210");

    // IT-BRN-01: Same mobile CAN join Branch 2 independently -> gets A001 cleanly!
    const createdBranch2 = await createPublicToken({
      salonSlug: salonA.organizationSlug,
      branchSlug: salonA.branch2.slug,
      fullName: "Rahul Sharma",
      mobileNumber: "9876543210",
      serviceIds: [salonA.haircutId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(createdBranch2.token.tokenNumber).toBe("A001");
    expect(createdBranch2.token.publicId).not.toBe(created1.token.publicId);

    // IT-PUB-02: Downstream notification hook throwing after commit NEVER fails token creation
    const createdWithFailingHook = await createPublicToken({
      salonSlug: salonA.organizationSlug,
      branchSlug: salonA.branch1.slug,
      fullName: "Priya Verma",
      mobileNumber: "9811122233",
      serviceIds: [salonA.beardId],
      now: OPEN_NOW,
      client: runtimePrisma,
      onTokenCommitted: () => {
        throw new Error("Simulated push dispatcher outage");
      },
    });
    expect(createdWithFailingHook.token.tokenNumber).toBe("A002");
    expect(createdWithFailingHook.token.queuePosition).toBe(2);
    expect(createdWithFailingHook.token.peopleAhead).toBe(1);
    expect(createdWithFailingHook.token.estimatedWaitMinutes).toBe(55);

    // Repeat visit after token completed reuses Customer row cleanly
    await adminTestPrisma.token.update({
      where: { publicId: created1.token.publicId },
      data: {
        status: "COMPLETED",
        serviceStartedAt: new Date(OPEN_NOW.getTime() - 60 * 60_000),
        completedAt: OPEN_NOW,
      },
    });
    const repeatVisit = await createPublicToken({
      salonSlug: salonA.organizationSlug,
      branchSlug: salonA.branch1.slug,
      fullName: "Rahul S.",
      mobileNumber: "9876543210",
      serviceIds: [salonA.beardId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(repeatVisit.token.tokenNumber).toBe("A003");
    const branchCustomers = await adminTestPrisma.customer.count({
      where: { branchId: salonA.branch1.id, mobileNumber: "9876543210" },
    });
    expect(branchCustomers).toBe(1);

    // Cross-tenant service injection must be rejected with 422 ServiceUnavailableError (TI-04)
    await expect(
      createPublicToken({
        salonSlug: salonA.organizationSlug,
        branchSlug: salonA.branch1.slug,
        fullName: "Attacker",
        mobileNumber: "9899900001",
        serviceIds: [salonB.haircutId],
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);

    // Outside business hours rejected with 403 BRANCH_NOT_ACCEPTING
    await expect(
      createPublicToken({
        salonSlug: salonA.organizationSlug,
        branchSlug: salonA.branch1.slug,
        fullName: "Night Owl",
        mobileNumber: "9899900002",
        serviceIds: [salonA.haircutId],
        now: CLOSED_NOW,
        client: runtimePrisma,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "BRANCH_NOT_ACCEPTING",
    });

    // Strict QR token verification
    await withBranchDb(
      salonA.organizationId,
      salonA.branch1.id,
      async (tx) => {
        await tx.salonSettings.upsert({
          where: {
            organizationId_branchId: {
              organizationId: salonA.organizationId,
              branchId: salonA.branch1.id,
            },
          },
          update: { requireValidQrToken: true },
          create: {
            organizationId: salonA.organizationId,
            branchId: salonA.branch1.id,
            requireValidQrToken: true,
          },
        });
      },
      runtimePrisma,
    );
    await expect(
      createPublicToken({
        salonSlug: salonA.organizationSlug,
        branchSlug: salonA.branch1.slug,
        fullName: "Wrong QR",
        mobileNumber: "9899900003",
        serviceIds: [salonA.haircutId],
        qrToken: "tampered",
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "QR_TOKEN_INVALID",
    });

    // Suspended org blocked
    await adminTestPrisma.organization.update({
      where: { id: salonA.organizationId },
      data: { status: "SUSPENDED" },
    });
    await expect(
      createPublicToken({
        salonSlug: salonA.organizationSlug,
        branchSlug: salonA.branch1.slug,
        fullName: "Suspended Test",
        mobileNumber: "9899900004",
        serviceIds: [salonA.haircutId],
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "TENANT_SUSPENDED",
    });

    // Inactive branch check on Salon B Branch 2
    await updateBranch(
      await authorizeTenantAction({
        session: salonB.ownerClaims,
        requiredPermission: "BRANCH_MANAGE",
        branchId: salonB.branch2.id,
        client: runtimePrisma,
      }),
      salonB.branch2.id,
      { isActive: false },
      { client: runtimePrisma },
    );
    await expect(
      createPublicToken({
        salonSlug: salonB.organizationSlug,
        branchSlug: salonB.branch2.slug,
        fullName: "Inactive Branch",
        mobileNumber: "9899900005",
        serviceIds: [salonB.haircutId],
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("applies clamped 30-day historical overrun factor (>= 20 completed tokens) inside WaitTimeService", async () => {
    const salon = await seedSalonWithTwoBranches("overrun");

    // Seed 20 historical completed tokens on a previous date taking 30m for 20m planned (1.5x -> clamped 1.35x)
    const yesterday = new Date("2026-11-10T00:00:00.000Z");
    const customer = await adminTestPrisma.customer.create({
      data: {
        organizationId: salon.organizationId,
        branchId: salon.branch1.id,
        name: "History Cust",
        mobileNumber: "9800000000",
      },
    });

    for (let i = 1; i <= 20; i += 1) {
      await adminTestPrisma.token.create({
        data: {
          publicId: `hist_${i}_${crypto.randomUUID().slice(0, 8)}`,
          organizationId: salon.organizationId,
          branchId: salon.branch1.id,
          customerId: customer.id,
          businessDate: yesterday,
          sequenceNumber: i,
          tokenNumber: `A${String(i).padStart(3, "0")}`,
          customerNameSnapshot: "History Cust",
          customerMobileSnapshot: "9800000000",
          status: "COMPLETED",
          totalPriceInPaise: 20000,
          totalDurationMinutes: 20,
          serviceStartedAt: new Date(OPEN_NOW.getTime() - 24 * 60 * 60_000),
          completedAt: new Date(OPEN_NOW.getTime() - 24 * 60 * 60_000 + 30 * 60_000),
        },
      });
    }

    // Create 1 active WAITING token (20m Beard) then check WaitTimeService projection for next joiner
    await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branch1.slug,
      fullName: "Customer One",
      mobileNumber: "9812340001",
      serviceIds: [salon.beardId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    const snapshot = await withBranchDb(
      salon.organizationId,
      salon.branch1.id,
      (tx) =>
        computeBranchWaitSnapshot(tx, {
          organizationId: salon.organizationId,
          branchId: salon.branch1.id,
          businessDate: new Date("2026-11-11T00:00:00.000Z"),
          activeStationsCount: 1,
          bufferMinutes: 0,
          now: OPEN_NOW,
        }),
      runtimePrisma,
    );

    expect(snapshot.overrunFactor).toBe(1.35);
    // 20m * 1.35 = 27m
    expect(snapshot.estimatedNewJoinWaitMinutes).toBe(27);
  });

  it("CT-01: 25 simultaneous public token submissions produce strictly gapless A001..A025", async () => {
    const salon = await seedSalonWithTwoBranches("ct01");

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        createPublicToken({
          salonSlug: salon.organizationSlug,
          branchSlug: salon.branch1.slug,
          fullName: `Customer ${index + 1}`,
          mobileNumber: `98765000${String(index).padStart(2, "0")}`,
          serviceIds: [salon.haircutId],
          now: OPEN_NOW,
          client: runtimePrisma,
        }),
      ),
    );

    const tokenNumbers = results.map((r) => r.token.tokenNumber).sort();
    const expected = Array.from(
      { length: 25 },
      (_, idx) => `A${String(idx + 1).padStart(3, "0")}`,
    );
    expect(tokenNumbers).toEqual(expected);

    const publicIds = new Set(results.map((r) => r.token.publicId));
    expect(publicIds.size).toBe(25);

    const counter = await adminTestPrisma.queueCounter.findFirst({
      where: { branchId: salon.branch1.id },
    });
    expect(counter?.lastNumber).toBe(25);

    const outboxCount = await adminTestPrisma.notificationEvent.count({
      where: { branchId: salon.branch1.id, eventType: "NEW_TOKEN_OWNER_ALERT" },
    });
    expect(outboxCount).toBe(25);
  });

  it("CT-02: 15 + 15 simultaneous submissions across two branches generate independent A001..A015 sequences", async () => {
    const salon = await seedSalonWithTwoBranches("ct02");

    const branch1Promises = Array.from({ length: 15 }, (_, index) =>
      createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branch1.slug,
        fullName: `B1 Customer ${index + 1}`,
        mobileNumber: `98111000${String(index).padStart(2, "0")}`,
        serviceIds: [salon.haircutId],
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    );

    const branch2Promises = Array.from({ length: 15 }, (_, index) =>
      createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branch2.slug,
        fullName: `B2 Customer ${index + 1}`,
        mobileNumber: `98222000${String(index).padStart(2, "0")}`,
        serviceIds: [salon.haircutId],
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    );

    const [b1Results, b2Results] = await Promise.all([
      Promise.all(branch1Promises),
      Promise.all(branch2Promises),
    ]);

    const expected = Array.from(
      { length: 15 },
      (_, idx) => `A${String(idx + 1).padStart(3, "0")}`,
    );
    expect(b1Results.map((r) => r.token.tokenNumber).sort()).toEqual(expected);
    expect(b2Results.map((r) => r.token.tokenNumber).sort()).toEqual(expected);

    const counters = await adminTestPrisma.queueCounter.findMany({
      where: { organizationId: salon.organizationId },
    });
    expect(counters).toHaveLength(2);
    expect(counters.every((c) => c.lastNumber === 15)).toBe(true);
  });

  it("CT-03: 10 concurrent duplicate-mobile submissions allow exactly 1 token and reject 9 with 409 ACTIVE_TOKEN_EXISTS", async () => {
    const salon = await seedSalonWithTwoBranches("ct03");

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        createPublicToken({
          salonSlug: salon.organizationSlug,
          branchSlug: salon.branch1.slug,
          fullName: "Same Customer",
          mobileNumber: "9876512345",
          serviceIds: [salon.haircutId],
          idempotencyKey: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
          now: OPEN_NOW,
          client: runtimePrisma,
        }),
      ),
    );

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value.token.tokenNumber).toBe("A001");
    expect(rejected).toHaveLength(9);

    for (const failure of rejected) {
      expect(failure.reason).toBeInstanceOf(ConflictError);
      expect((failure.reason as ConflictError).code).toBe("ACTIVE_TOKEN_EXISTS");
    }

    const counter = await adminTestPrisma.queueCounter.findFirst({
      where: { branchId: salon.branch1.id },
    });
    expect(counter?.lastNumber).toBe(1);
  });

  it("CT-04: 10 concurrent double-taps with identical idempotencyKey return identical publicId and A001 without duplicate DB inserts", async () => {
    const salon = await seedSalonWithTwoBranches("ct04");
    const sharedKey = crypto.randomUUID();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createPublicToken({
          salonSlug: salon.organizationSlug,
          branchSlug: salon.branch1.slug,
          fullName: "Double Tapper",
          mobileNumber: "9876598765",
          serviceIds: [salon.haircutId],
          idempotencyKey: sharedKey,
          now: OPEN_NOW,
          client: runtimePrisma,
        }),
      ),
    );

    const uniquePublicIds = new Set(results.map((r) => r.token.publicId));
    const uniqueNumbers = new Set(results.map((r) => r.token.tokenNumber));
    const createdCount = results.filter((r) => !r.isIdempotentReplay).length;
    const replayCount = results.filter((r) => r.isIdempotentReplay).length;

    expect(uniquePublicIds.size).toBe(1);
    expect(uniqueNumbers).toEqual(new Set(["A001"]));
    expect(createdCount).toBe(1);
    expect(replayCount).toBe(9);

    const dbTokenCount = await adminTestPrisma.token.count({
      where: { branchId: salon.branch1.id },
    });
    expect(dbTokenCount).toBe(1);

    const counter = await adminTestPrisma.queueCounter.findFirst({
      where: { branchId: salon.branch1.id },
    });
    expect(counter?.lastNumber).toBe(1);
  });
});
