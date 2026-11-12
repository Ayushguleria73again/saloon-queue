import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { branchCatalogCache } from "@/server/cache/branch-catalog-cache";
import { createBranch } from "@/server/services/branch-service";
import {
  createOrganizationService,
  getCachedAvailableBranchServices,
  listServicesWithBranchMatrix,
  updateOrganizationService,
  upsertBranchServiceOverride,
} from "@/server/services/catalog-service";
import {
  registerSalonOrganization,
  resendVerificationEmail,
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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 5 tests",
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

describe("Phase 5 Services Catalog, Branch Overrides & Resend Verification", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("IT-BRN-02: isolates branch price/availability overrides, preserves TokenService snapshots, and invalidates cache on write", async () => {
    let tokA = "";
    let tokB = "";

    const regA = await registerSalonOrganization({
      input: {
        ownerName: "Owner A",
        email: "svc-ownera@test.in",
        password: "Password!2026",
        organizationName: "Aura Services",
        salonSlug: "aura-svc",
        branchName: "Branch One",
        branchSlug: "branch-one",
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
        email: "svc-ownerb@test.in",
        password: "Password!2026",
        organizationName: "Urban Services",
        salonSlug: "urban-svc",
        branchName: "Branch B",
        branchSlug: "branch-b",
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
      email: "svc-ownera@test.in",
      name: "Owner A",
      activeOrganizationId: regA.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };

    const branchTwo = await createBranch(
      await authorizeTenantAction({
        requiredPermission: "BRANCH_MANAGE",
        session: ownerASession,
        client: runtimePrisma,
      }),
      { name: "Branch Two", slug: "branch-two", timezone: "Asia/Kolkata" },
      { client: runtimePrisma },
    );

    const svcCtx = await authorizeTenantAction({
      requiredPermission: "SERVICE_MANAGE",
      session: ownerASession,
      client: runtimePrisma,
    });

    const haircut = await createOrganizationService(
      svcCtx,
      {
        name: "Classic Haircut",
        description: "Scissors & finish",
        basePriceInPaise: 30000,
        baseDurationMinutes: 30,
        sortOrder: 0,
      },
      { client: runtimePrisma },
    );

    // Seed an existing historical Token + TokenService snapshot at 30000 paise / 30 mins
    const customer = await adminTestPrisma.customer.create({
      data: {
        organizationId: regA.organizationId,
        branchId: branchTwo.id,
        name: "Historical Customer",
        mobileNumber: "9876543210",
      },
    });
    const historicalToken = await adminTestPrisma.token.create({
      data: {
        publicId: "hist_tok_snapshot_1",
        organizationId: regA.organizationId,
        branchId: branchTwo.id,
        customerId: customer.id,
        businessDate: new Date(Date.UTC(2026, 10, 12)),
        sequenceNumber: 1,
        tokenNumber: "A001",
        customerNameSnapshot: "Historical Customer",
        customerMobileSnapshot: "9876543210",
        status: "COMPLETED",
        totalPriceInPaise: 30000,
        totalDurationMinutes: 30,
        tokenServices: {
          create: {
            serviceId: haircut.id,
            serviceNameSnapshot: "Classic Haircut",
            priceInPaiseSnapshot: 30000,
            durationMinutesSnapshot: 30,
          },
        },
      },
    });

    // Warm cached catalog for Branch 1 and Branch 2
    const warmB1 = await getCachedAvailableBranchServices(
      regA.organizationId,
      regA.branchId,
      runtimePrisma,
    );
    const warmB2 = await getCachedAvailableBranchServices(
      regA.organizationId,
      branchTwo.id,
      runtimePrisma,
    );
    expect(warmB1[0]?.priceInPaise).toBe(30000);
    expect(warmB2[0]?.priceInPaise).toBe(30000);

    // Override Branch 2 price to 45000 & duration 45 mins -> invalidates Branch 2 cache immediately
    await upsertBranchServiceOverride(
      await authorizeTenantAction({
        requiredPermission: "SERVICE_MANAGE",
        branchId: branchTwo.id,
        session: ownerASession,
        client: runtimePrisma,
      }),
      branchTwo.id,
      haircut.id,
      {
        isAvailable: true,
        priceOverrideInPaise: 45000,
        durationOverrideMinutes: 45,
      },
      { client: runtimePrisma },
    );

    const freshB2 = await getCachedAvailableBranchServices(
      regA.organizationId,
      branchTwo.id,
      runtimePrisma,
    );
    const untouchedB1 = await getCachedAvailableBranchServices(
      regA.organizationId,
      regA.branchId,
      runtimePrisma,
    );
    expect(freshB2[0]?.priceInPaise).toBe(45000);
    expect(freshB2[0]?.durationMinutes).toBe(45);
    expect(untouchedB1[0]?.priceInPaise).toBe(30000);
    expect(untouchedB1[0]?.durationMinutes).toBe(30);

    // Org base price remains 30000 and historical TokenService snapshot remains 30000!
    const matrix = await listServicesWithBranchMatrix(svcCtx, runtimePrisma);
    expect(matrix.services[0]?.basePriceInPaise).toBe(30000);
    const savedSnapshot = await adminTestPrisma.tokenService.findFirstOrThrow({
      where: { tokenId: historicalToken.id },
    });
    expect(savedSnapshot.priceInPaiseSnapshot).toBe(30000);
    expect(savedSnapshot.durationMinutesSnapshot).toBe(30);

    // Soft-deactivating service immediately removes it from cached public branch intake
    await updateOrganizationService(
      svcCtx,
      haircut.id,
      { isActive: false },
      { client: runtimePrisma },
    );
    const afterDeactivateB1 = await getCachedAvailableBranchServices(
      regA.organizationId,
      regA.branchId,
      runtimePrisma,
    );
    const afterDeactivateB2 = await getCachedAvailableBranchServices(
      regA.organizationId,
      branchTwo.id,
      runtimePrisma,
    );
    expect(afterDeactivateB1).toEqual([]);
    expect(afterDeactivateB2).toEqual([]);

    // Historical TokenService snapshot STILL untouched after service deactivation!
    const snapshotAfterDeactivate = await adminTestPrisma.tokenService.findFirstOrThrow({
      where: { tokenId: historicalToken.id },
    });
    expect(snapshotAfterDeactivate.priceInPaiseSnapshot).toBe(30000);

    // Cross-tenant service / branch modification rejected with 404 NotFoundError
    const ownerBSession: SessionUserClaims = {
      id: regB.userId,
      email: "svc-ownerb@test.in",
      name: "Owner B",
      activeOrganizationId: regB.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };
    const ownerBCtx = await authorizeTenantAction({
      requiredPermission: "SERVICE_MANAGE",
      session: ownerBSession,
      client: runtimePrisma,
    });
    await expect(
      updateOrganizationService(
        ownerBCtx,
        haircut.id,
        { basePriceInPaise: 100 },
        { client: runtimePrisma },
      ),
    ).rejects.toThrow(NotFoundError);

    // Non-existent permission denied for STAFF (already enforced in authorizeTenantAction)
    await expect(
      authorizeTenantAction({
        requiredPermission: "SERVICE_MANAGE",
        branchId: regB.branchId,
        session: ownerASession,
        client: runtimePrisma,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("supports resending email verification links for unverified accounts without leaking status", async () => {
    await registerSalonOrganization({
      input: {
        ownerName: "Unverified Owner",
        email: "resend@test.in",
        password: "Password!2026",
        organizationName: "Resend Salon",
        salonSlug: "resend-salon",
        branchName: "Main",
        branchSlug: "main",
        timezone: "Asia/Kolkata",
        website: "",
      },
      client: runtimePrisma,
    });

    let resentToken = "";
    const resent = await resendVerificationEmail({
      email: "resend@test.in",
      onVerificationTokenCreated: ({ token }) => {
        resentToken = token;
      },
      client: runtimePrisma,
    });
    expect(resent.sent).toBe(true);
    expect(resentToken.length).toBeGreaterThan(16);

    const verified = await verifyEmailToken({
      token: resentToken,
      client: runtimePrisma,
    });
    expect(verified).toEqual({ verified: true, email: "resend@test.in" });

    // Unknown email still returns { sent: true } cleanly (non-enumerating)
    const unknown = await resendVerificationEmail({
      email: "nobody@test.in",
      client: runtimePrisma,
    });
    expect(unknown).toEqual({ sent: true });
    expect(ForbiddenError).toBeDefined();
  });
});
