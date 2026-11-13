import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeTenantAction,
  requirePlatformAdmin,
  type SessionUserClaims,
} from "@/server/auth";
import { updateBranch } from "@/server/services/branch-service";
import { createOrganizationService } from "@/server/services/catalog-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import { createPublicToken } from "@/server/services/token-service";
import {
  getPlatformHealthDetails,
  getPlatformOverview,
  listPlatformJobs,
  listTenants,
  retryPlatformJob,
  updateTenantStatus,
} from "@/server/services/platform-admin-service";
import { ForbiddenError } from "@/lib/errors";

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
  throw new Error("TEST_DATABASE_URL and DIRECT_URL must be configured to run tests");
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

const OPEN_NOW = new Date("2026-11-13T10:00:00.000Z");

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

async function seedTestSalon(prefix: string) {
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

  const branchManageCtx = await authorizeTenantAction({
    session: ownerClaims,
    requiredPermission: "BRANCH_MANAGE",
    client: runtimePrisma,
  });

  await updateBranch(
    branchManageCtx,
    reg.branchId,
    {
      settings: {
        allowDuplicateActiveTokens: false,
        allowCustomerCancel: true,
        enforceBusinessHours: false,
        isAcceptingTokens: true,
        activeStationsCount: 2,
      },
    },
    { client: runtimePrisma },
  );

  const serviceManageCtx = await authorizeTenantAction({
    session: ownerClaims,
    requiredPermission: "SERVICE_MANAGE",
    client: runtimePrisma,
  });

  const service = await createOrganizationService(
    serviceManageCtx,
    {
      name: "Hair Styling",
      baseDurationMinutes: 20,
      basePriceInPaise: 25000,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  return {
    organizationId: reg.organizationId,
    organizationSlug: `${lower}-salon`,
    branchId: reg.branchId,
    branchSlug: "main",
    ownerClaims,
    serviceId: service.id,
  };
}

async function seedPlatformAdmin() {
  const adminUser = await adminTestPrisma.user.create({
    data: {
      name: "System Operator",
      email: "operator@salonflow.internal",
      passwordHash: "hash_placeholder",
      isPlatformAdmin: true,
      isActive: true,
      sessionVersion: 1,
    },
  });

  const adminClaims: SessionUserClaims = {
    id: adminUser.id,
    email: adminUser.email,
    name: adminUser.name,
    isPlatformAdmin: true,
    sessionVersion: 1,
    activeOrganizationId: null,
  };

  return { adminUser, adminClaims };
}

describe("Phase 15: Platform Administration Suite", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("IT-ADM-01: suspending an Organization blocks public token intake and owner mutations across all branches (403 TENANT_SUSPENDED)", async () => {
    const salon = await seedTestSalon("Adm01");
    const { adminClaims } = await seedPlatformAdmin();

    const adminCtx = await requirePlatformAdmin({
      session: adminClaims,
      client: runtimePrisma,
    });

    // 1. Verify token creation works when ACTIVE
    const activeToken = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Anand Kumar",
      mobileNumber: "9876543201",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(activeToken.token.tokenNumber).toBe("A001");

    // 2. Platform Admin suspends Organization
    const updatedTenant = await updateTenantStatus(
      adminCtx,
      salon.organizationId,
      {
        status: "SUSPENDED",
        reason: "Delinquent payment terms review.",
      },
      { client: runtimePrisma },
    );
    expect(updatedTenant.status).toBe("SUSPENDED");

    // Verify audit log recorded for status change
    const auditLog = await adminTestPrisma.auditLog.findFirst({
      where: {
        organizationId: salon.organizationId,
        action: "TENANT_STATUS_CHANGED",
      },
    });
    expect(auditLog).toBeDefined();
    expect((auditLog?.metadata as Record<string, unknown>)?.newStatus).toBe("SUSPENDED");

    // 3. Verify public intake is immediately BLOCKED with 403 TENANT_SUSPENDED
    await expect(
      createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: "Blocked Customer",
        mobileNumber: "9876543202",
        serviceIds: [salon.serviceId],
        now: OPEN_NOW,
        client: runtimePrisma,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "TENANT_SUSPENDED",
        statusCode: 403,
      }),
    );

    // 4. Verify owner action is BLOCKED with 403 TENANT_SUSPENDED
    await expect(
      authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "QUEUE_CALL_NEXT",
        branchId: salon.branchId,
        client: runtimePrisma,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "TENANT_SUSPENDED",
        statusCode: 403,
      }),
    );

    // 5. Platform Admin reactivates Organization
    const reactivatedTenant = await updateTenantStatus(
      adminCtx,
      salon.organizationId,
      {
        status: "ACTIVE",
        reason: "Account verified and billing settled.",
      },
      { client: runtimePrisma },
    );
    expect(reactivatedTenant.status).toBe("ACTIVE");

    // 6. Public intake succeeds again
    const resumedToken = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: "Pooja Sharma",
      mobileNumber: "9876543203",
      serviceIds: [salon.serviceId],
      now: OPEN_NOW,
      client: runtimePrisma,
    });
    expect(resumedToken.token.tokenNumber).toBe("A002");
  });

  it("IT-ADM-02: platform overview, tenant directory, and job inspection never expose customer names or mobile numbers", async () => {
    const salon = await seedTestSalon("Adm02");
    const { adminClaims } = await seedPlatformAdmin();

    const adminCtx = await requirePlatformAdmin({
      session: adminClaims,
      client: runtimePrisma,
    });

    // Create a customer token with identifiable PII
    const sensitiveName = "Secret Celebrity Customer";
    const sensitiveMobile = "9876543299";

    const created = await createPublicToken({
      salonSlug: salon.organizationSlug,
      branchSlug: salon.branchSlug,
      fullName: sensitiveName,
      mobileNumber: sensitiveMobile,
      serviceIds: [salon.serviceId],
      notes: "High profile VIP customer",
      now: OPEN_NOW,
      client: runtimePrisma,
    });

    // Create an outbox event
    const createdTokenDb = await adminTestPrisma.token.findUniqueOrThrow({
      where: { publicId: created.token.publicId },
      select: { id: true },
    });

    await adminTestPrisma.notificationEvent.create({
      data: {
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        tokenId: createdTokenDb.id,
        eventType: "TOKEN_CALLED",
        idempotencyKey: `test:evt:${createdTokenDb.id}`,
        payload: {
          tokenNumber: "A001",
          estimatedWaitMinutes: 0,
        },
        status: "DEAD_LETTER",
        attemptCount: 5,
        lastError: "WebPush 503 Provider Unavailable",
      },
    });

    // 1. Inspect Platform Overview
    const overview = await getPlatformOverview(adminCtx, runtimePrisma);
    expect(overview.organizations.total).toBeGreaterThanOrEqual(1);
    expect(overview.jobs.deadLetter).toBe(1);

    const overviewJson = JSON.stringify(overview);
    expect(overviewJson).not.toContain(sensitiveName);
    expect(overviewJson).not.toContain(sensitiveMobile);
    expect(overviewJson).not.toContain("VIP");

    // 2. Inspect Tenants Directory
    const tenantsList = await listTenants(
      adminCtx,
      { status: "ALL", page: 1, limit: 20 },
      runtimePrisma,
    );
    expect(tenantsList.items.length).toBeGreaterThanOrEqual(1);

    const tenantsJson = JSON.stringify(tenantsList);
    expect(tenantsJson).not.toContain(sensitiveName);
    expect(tenantsJson).not.toContain(sensitiveMobile);
    expect(tenantsJson).not.toContain("VIP");

    // 3. Inspect Platform Jobs
    const jobsList = await listPlatformJobs(
      adminCtx,
      { status: "ALL", page: 1, limit: 20 },
      runtimePrisma,
    );
    expect(jobsList.items.length).toBeGreaterThanOrEqual(1);

    const firstJob = jobsList.items.find((j) => j.eventType === "TOKEN_CALLED");
    expect(firstJob).toBeDefined();
    expect(firstJob?.eventType).toBe("TOKEN_CALLED");
    expect(firstJob?.status).toBe("DEAD_LETTER");
    expect(firstJob?.attemptCount).toBe(5);
    expect(firstJob?.lastError).toContain("503");

    const jobsJson = JSON.stringify(jobsList);
    expect(jobsJson).not.toContain(sensitiveName);
    expect(jobsJson).not.toContain(sensitiveMobile);
    expect(jobsJson).not.toContain("VIP");
  });

  it("retries a dead-lettered background job and resets attempt counts", async () => {
    const salon = await seedTestSalon("Adm03");
    const { adminClaims } = await seedPlatformAdmin();

    const adminCtx = await requirePlatformAdmin({
      session: adminClaims,
      client: runtimePrisma,
    });

    const deadLetterEvent = await adminTestPrisma.notificationEvent.create({
      data: {
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        eventType: "TOKEN_CALLED",
        idempotencyKey: `test:retry:${Date.now()}`,
        payload: { tokenNumber: "A001" },
        status: "DEAD_LETTER",
        attemptCount: 5,
        lastError: "VAPID key expired or revoked",
      },
    });

    // Retry event
    const retryResult = await retryPlatformJob(adminCtx, deadLetterEvent.id, {
      client: runtimePrisma,
    });
    expect(retryResult.success).toBe(true);

    // Verify row was reset
    const refreshed = await adminTestPrisma.notificationEvent.findUniqueOrThrow({
      where: { id: deadLetterEvent.id },
    });
    expect(refreshed.status).toBe("PENDING");
    expect(refreshed.attemptCount).toBe(0);
    expect(refreshed.lastError).toBeNull();

    // Verify audit log
    const retryAudit = await adminTestPrisma.auditLog.findFirst({
      where: {
        entityId: deadLetterEvent.id,
        action: "JOB_RETRIED",
      },
    });
    expect(retryAudit).toBeDefined();
    expect(retryAudit?.actorType).toBe("PLATFORM_ADMIN");
  });

  it("blocks non-admin users from accessing Platform Admin functions", async () => {
    const salon = await seedTestSalon("Adm04");

    // Regular salon owner attempting to invoke requirePlatformAdmin
    await expect(
      requirePlatformAdmin({
        session: salon.ownerClaims,
        client: runtimePrisma,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("provides platform diagnostic health telemetry", async () => {
    const { adminClaims } = await seedPlatformAdmin();
    const adminCtx = await requirePlatformAdmin({
      session: adminClaims,
      client: runtimePrisma,
    });

    const health = await getPlatformHealthDetails(adminCtx, runtimePrisma);
    expect(health.status).toBe("healthy");
    expect(health.database.connected).toBe(true);
    expect(health.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.nodeVersion).toBeDefined();
  });
});
