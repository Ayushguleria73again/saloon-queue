import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ServiceUnavailableError } from "@/lib/errors";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { branchCatalogCache } from "@/server/cache/branch-catalog-cache";
import { withBranchDb } from "@/server/db";
import {
  getPublicBranchSnapshot,
  validateBranchServiceSelection,
} from "@/server/services/branch-public-service";
import { createBranch, updateBranch } from "@/server/services/branch-service";
import {
  createOrganizationService,
  upsertBranchServiceOverride,
} from "@/server/services/catalog-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";

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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 6 tests",
  );
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

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

describe("Phase 6 BranchPublicService, Availability States & TI-04", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("returns open branch snapshot with cached priced services, closed schedule outside hours, and unavailable when suspended", async () => {
    let tokA = "";
    const regA = await registerSalonOrganization({
      input: {
        ownerName: "Owner A",
        email: "pub-ownera@test.in",
        password: "Password!2026",
        organizationName: "Aura Public",
        salonSlug: "aura-public",
        branchName: "Koramangala",
        branchSlug: "koramangala",
        city: "Bengaluru",
        timezone: "Asia/Kolkata",
        website: "",
      },
      onVerificationTokenCreated: ({ token }) => {
        tokA = token;
      },
      client: runtimePrisma,
    });
    await verifyEmailToken({ token: tokA, client: runtimePrisma });

    const ownerSession: SessionUserClaims = {
      id: regA.userId,
      email: "pub-ownera@test.in",
      name: "Owner A",
      activeOrganizationId: regA.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };

    const svc = await createOrganizationService(
      await authorizeTenantAction({
        requiredPermission: "SERVICE_MANAGE",
        session: ownerSession,
        client: runtimePrisma,
      }),
      {
        name: "Beard Styling",
        basePriceInPaise: 15000,
        baseDurationMinutes: 15,
        sortOrder: 0,
      },
      { client: runtimePrisma },
    );

    // Unknown slug returns 404
    await expect(
      getPublicBranchSnapshot({
        salonSlug: "no-such-salon",
        branchSlug: "koramangala",
        client: runtimePrisma,
      }),
    ).rejects.toThrow(NotFoundError);

    // 14:00 IST (08:30 UTC) is open (09:30-21:30)
    const openTime = new Date("2026-11-12T08:30:00.000Z");
    const openSnap = await getPublicBranchSnapshot({
      salonSlug: "aura-public",
      branchSlug: "koramangala",
      now: openTime,
      client: runtimePrisma,
    });

    expect(openSnap.intake.canAcceptTokens).toBe(true);
    expect(openSnap.intake.reason).toBeNull();
    expect(openSnap.services).toHaveLength(1);
    expect(openSnap.services[0]?.id).toBe(svc.id);
    expect(openSnap.services[0]?.priceInPaise).toBe(15000);

    // 23:00 IST (17:30 UTC) is closed -> returns weekly schedule & canAcceptTokens = false
    const closedTime = new Date("2026-11-12T17:30:00.000Z");
    const closedSnap = await getPublicBranchSnapshot({
      salonSlug: "aura-public",
      branchSlug: "koramangala",
      now: closedTime,
      client: runtimePrisma,
    });
    expect(closedSnap.intake.canAcceptTokens).toBe(false);
    expect(closedSnap.intake.reason).toBe("BRANCH_CLOSED");
    expect(closedSnap.businessHours).toHaveLength(7);

    // Suspending organization blocks intake cleanly with TENANT_SUSPENDED
    await adminTestPrisma.organization.update({
      where: { id: regA.organizationId },
      data: { status: "SUSPENDED" },
    });
    const suspendedSnap = await getPublicBranchSnapshot({
      salonSlug: "aura-public",
      branchSlug: "koramangala",
      now: openTime,
      client: runtimePrisma,
    });
    expect(suspendedSnap.intake.canAcceptTokens).toBe(false);
    expect(suspendedSnap.intake.reason).toBe("TENANT_SUSPENDED");
    expect(suspendedSnap.services).toEqual([]);
  });

  it("TI-04: rejects cross-tenant, cross-branch, and branch-disabled service IDs with 422 SERVICE_UNAVAILABLE", async () => {
    let tokA = "";
    let tokB = "";
    const regA = await registerSalonOrganization({
      input: {
        ownerName: "Owner A",
        email: "ti04-a@test.in",
        password: "Password!2026",
        organizationName: "Tenant A",
        salonSlug: "ti04-a",
        branchName: "Branch 1",
        branchSlug: "b1",
        timezone: "Asia/Kolkata",
        website: "",
      },
      onVerificationTokenCreated: ({ token }) => {
        tokA = token;
      },
      client: runtimePrisma,
    });
    await verifyEmailToken({ token: tokA, client: runtimePrisma });

    const regB = await registerSalonOrganization({
      input: {
        ownerName: "Owner B",
        email: "ti04-b@test.in",
        password: "Password!2026",
        organizationName: "Tenant B",
        salonSlug: "ti04-b",
        branchName: "Branch B1",
        branchSlug: "bb1",
        timezone: "Asia/Kolkata",
        website: "",
      },
      onVerificationTokenCreated: ({ token }) => {
        tokB = token;
      },
      client: runtimePrisma,
    });
    await verifyEmailToken({ token: tokB, client: runtimePrisma });

    const ownerASession: SessionUserClaims = {
      id: regA.userId,
      email: "ti04-a@test.in",
      name: "Owner A",
      activeOrganizationId: regA.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };
    const ownerBSession: SessionUserClaims = {
      id: regB.userId,
      email: "ti04-b@test.in",
      name: "Owner B",
      activeOrganizationId: regB.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };

    const branchA2 = await createBranch(
      await authorizeTenantAction({
        requiredPermission: "BRANCH_MANAGE",
        session: ownerASession,
        client: runtimePrisma,
      }),
      { name: "Branch 2", slug: "b2", timezone: "Asia/Kolkata" },
      { client: runtimePrisma },
    );

    const svcA = await createOrganizationService(
      await authorizeTenantAction({
        requiredPermission: "SERVICE_MANAGE",
        session: ownerASession,
        client: runtimePrisma,
      }),
      {
        name: "Haircut A",
        basePriceInPaise: 30000,
        baseDurationMinutes: 30,
        sortOrder: 0,
      },
      { client: runtimePrisma },
    );

    const svcB = await createOrganizationService(
      await authorizeTenantAction({
        requiredPermission: "SERVICE_MANAGE",
        session: ownerBSession,
        client: runtimePrisma,
      }),
      {
        name: "Haircut B",
        basePriceInPaise: 40000,
        baseDurationMinutes: 30,
        sortOrder: 0,
      },
      { client: runtimePrisma },
    );

    // Disable svcA specifically at Branch 1 (remains active at Branch 2)
    await upsertBranchServiceOverride(
      await authorizeTenantAction({
        requiredPermission: "SERVICE_MANAGE",
        branchId: regA.branchId,
        session: ownerASession,
        client: runtimePrisma,
      }),
      regA.branchId,
      svcA.id,
      { isAvailable: false },
      { client: runtimePrisma },
    );

    await withBranchDb(
      regA.organizationId,
      regA.branchId,
      async (tx) => {
        // Cross-tenant service injection -> 422 SERVICE_UNAVAILABLE
        await expect(
          validateBranchServiceSelection(tx, regA.organizationId, regA.branchId, [
            svcB.id,
          ]),
        ).rejects.toThrow(ServiceUnavailableError);

        // Unavailable at Branch 1 -> 422 SERVICE_UNAVAILABLE
        await expect(
          validateBranchServiceSelection(tx, regA.organizationId, regA.branchId, [
            svcA.id,
          ]),
        ).rejects.toThrow(ServiceUnavailableError);
      },
      runtimePrisma,
    );

    // Valid at Branch 2!
    await withBranchDb(
      regA.organizationId,
      branchA2.id,
      async (tx) => {
        const selected = await validateBranchServiceSelection(
          tx,
          regA.organizationId,
          branchA2.id,
          [svcA.id],
        );
        expect(selected[0]?.serviceNameSnapshot).toBe("Haircut A");
      },
      runtimePrisma,
    );

    // Ensure updateBranch strict QR token check works cleanly
    await updateBranch(
      await authorizeTenantAction({
        requiredPermission: "BRANCH_MANAGE",
        branchId: branchA2.id,
        session: ownerASession,
        client: runtimePrisma,
      }),
      branchA2.id,
      { settings: { requireValidQrToken: true } },
      { client: runtimePrisma },
    );
    const missingQrSnap = await getPublicBranchSnapshot({
      salonSlug: "ti04-a",
      branchSlug: "b2",
      qrToken: "wrong-qr",
      now: new Date("2026-11-12T08:30:00.000Z"),
      client: runtimePrisma,
    });
    expect(missingQrSnap.intake.canAcceptTokens).toBe(false);
    expect(missingQrSnap.intake.reason).toBe("QR_TOKEN_INVALID");
  });
});
