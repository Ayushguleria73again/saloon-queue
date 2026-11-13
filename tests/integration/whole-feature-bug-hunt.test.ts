import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { createBranch, updateBranch } from "@/server/services/branch-service";
import {
  createOrganizationService,
  upsertBranchServiceOverride,
  getCachedAvailableBranchServices,
} from "@/server/services/catalog-service";
import {
  createStaffInvite,
  acceptStaffInvite,
  revokeStaffMember,
} from "@/server/services/staff-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import {
  callNextToken,
  requeueSkippedToken,
  transitionBranchToken,
} from "@/server/services/queue-service";
import {
  createPublicToken,
  resolvePublicBranchIdentity,
} from "@/server/services/token-service";
import {
  cancelPublicToken,
  getPublicTokenTracking,
  resolvePublicTokenScope,
} from "@/server/services/token-tracking-service";
import { getTenantAnalytics } from "@/server/services/analytics-service";
import {
  getPlatformOverview,
  updateTenantStatus,
  listTenants,
} from "@/server/services/platform-admin-service";
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
  throw new Error("TEST_DATABASE_URL and DIRECT_URL must be configured");
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

const NOW = new Date("2026-11-13T10:00:00.000Z");

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
  let verificationToken = "";
  const reg = await registerSalonOrganization({
    input: {
      organizationName: `${prefix} Salon`,
      salonSlug: `${lower}-salon`,
      branchName: "Main Branch",
      branchSlug: "main",
      ownerName: `${prefix} Owner`,
      email: `${lower}.owner@example.com`,
      password: "Password123!",
      timezone: "Asia/Kolkata",
      website: "",
    },
    now: NOW,
    client: runtimePrisma,
    onVerificationTokenCreated: ({ token }) => {
      verificationToken = token;
    },
  });

  await verifyEmailToken({ token: verificationToken, client: runtimePrisma });

  const ownerUser = await adminTestPrisma.user.findUniqueOrThrow({
    where: { id: reg.userId },
  });

  const ownerClaims: SessionUserClaims = {
    id: ownerUser.id,
    email: ownerUser.email,
    name: ownerUser.name,
    activeOrganizationId: reg.organizationId,
    sessionVersion: ownerUser.sessionVersion,
    isPlatformAdmin: false,
  };

  const ownerCtx = await authorizeTenantAction({
    session: ownerClaims,
    requiredPermission: "SERVICE_MANAGE",
    branchId: reg.branchId,
    client: runtimePrisma,
  });

  const haircut = await createOrganizationService(
    ownerCtx,
    {
      name: "Haircut",
      basePriceInPaise: 25000,
      baseDurationMinutes: 30,
      sortOrder: 0,
    },
    { client: runtimePrisma },
  );

  const styling = await createOrganizationService(
    ownerCtx,
    {
      name: "Styling",
      basePriceInPaise: 40000,
      baseDurationMinutes: 45,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  // Set branch 1 to 2 stations, customer cancel enabled
  await updateBranch(
    ownerCtx,
    reg.branchId,
    {
      settings: {
        activeStationsCount: 2,
        allowCustomerCancel: true,
        allowDuplicateActiveTokens: false,
      },
    },
    { now: NOW, client: runtimePrisma },
  );

  return {
    organizationId: reg.organizationId,
    organizationSlug: `${lower}-salon`,
    branchId: reg.branchId,
    branchSlug: "main",
    ownerClaims,
    haircutServiceId: haircut.id,
    stylingServiceId: styling.id,
  };
}

describe("Whole-Feature Bug Hunt & Invariant Verification Suite", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  // =========================================================================
  // Feature Group 1: Public Intake & Token Generation Invariants
  // =========================================================================
  describe("1. Public Intake & Token Generation Invariants", () => {
    it("strictly blocks customer self-cancellation once token is CALLED or IN_SERVICE", async () => {
      const salon = await seedTestSalon("SelfCancelTest");

      // Customer joins queue
      const created = await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: "Rahul Verma",
        mobileNumber: "9876543210",
        serviceIds: [salon.haircutServiceId],
        now: NOW,
        client: runtimePrisma,
      });

      // While WAITING: tracking shows canCustomerCancel = true
      const trackingWaiting = await getPublicTokenTracking({
        publicId: created.token.publicId,
        client: runtimePrisma,
      });
      expect(trackingWaiting.canCustomerCancel).toBe(true);

      // Staff calls token
      const staffCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "QUEUE_CALL_NEXT",
        branchId: salon.branchId,
        client: runtimePrisma,
      });
      await callNextToken(staffCtx, salon.branchId, { now: NOW, client: runtimePrisma });

      // After CALLED: tracking shows canCustomerCancel = false
      const trackingCalled = await getPublicTokenTracking({
        publicId: created.token.publicId,
        client: runtimePrisma,
      });
      expect(trackingCalled.status).toBe("CALLED");
      expect(trackingCalled.canCustomerCancel).toBe(false);

      // Customer attempting to cancel when CALLED must throw ConflictError (SELF_CANCEL_NOT_ALLOWED)
      await expect(
        cancelPublicToken({
          publicId: created.token.publicId,
          reason: "I changed my mind",
          now: NOW,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("Tokens can only be cancelled online while still waiting in the queue.");
    });

    it("strictly blocks customer cancellation when branch setting allowCustomerCancel is false", async () => {
      const salon = await seedTestSalon("CancelPolicyTest");

      // Turn off allowCustomerCancel on branch
      const ownerCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "SETTINGS_MANAGE",
        branchId: salon.branchId,
        client: runtimePrisma,
      });
      await updateBranch(
        ownerCtx,
        salon.branchId,
        { settings: { allowCustomerCancel: false } },
        { now: NOW, client: runtimePrisma },
      );

      // Customer joins queue
      const created = await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: "Aarav Patel",
        mobileNumber: "9876543210",
        serviceIds: [salon.haircutServiceId],
        now: NOW,
        client: runtimePrisma,
      });

      const tracking = await getPublicTokenTracking({
        publicId: created.token.publicId,
        client: runtimePrisma,
      });
      expect(tracking.canCustomerCancel).toBe(false);
      expect(tracking.allowCustomerCancelSetting).toBe(false);

      await expect(
        cancelPublicToken({
          publicId: created.token.publicId,
          now: NOW,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("Online token cancellation is disabled for this branch.");
    });

    it("prevents duplicate active tokens for the same mobile when allowDuplicateActiveTokens is false", async () => {
      const salon = await seedTestSalon("DupTokenTest");

      // First token succeeds
      await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: "Pooja Reddy",
        mobileNumber: "9123456789",
        serviceIds: [salon.haircutServiceId],
        now: NOW,
        client: runtimePrisma,
      });

      // Second token with same mobile while first is WAITING must fail
      await expect(
        createPublicToken({
          salonSlug: salon.organizationSlug,
          branchSlug: salon.branchSlug,
          fullName: "Pooja Duplicate",
          mobileNumber: "9123456789",
          serviceIds: [salon.stylingServiceId],
          now: NOW,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("An active token already exists for this mobile number at this branch.");
    });
  });

  // =========================================================================
  // Feature Group 2: FIFO Queue Engine & State Transitions
  // =========================================================================
  describe("2. FIFO Queue Engine State Machine Invariants", () => {
    it("throws NO_WAITING_CUSTOMERS when callNextToken is executed on an empty queue", async () => {
      const salon = await seedTestSalon("EmptyQueueTest");

      const staffCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "QUEUE_CALL_NEXT",
        branchId: salon.branchId,
        client: runtimePrisma,
      });

      await expect(
        callNextToken(staffCtx, salon.branchId, { now: NOW, client: runtimePrisma }),
      ).rejects.toThrow("No customers are currently waiting in this branch queue.");
    });

    it("forbids illegal state transition: WAITING directly to COMPLETED without IN_SERVICE", async () => {
      const salon = await seedTestSalon("IllegalTransitionTest");

      const created = await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: "Vikas Seth",
        mobileNumber: "9988776655",
        serviceIds: [salon.haircutServiceId],
        now: NOW,
        client: runtimePrisma,
      });

      const scope = await resolvePublicTokenScope(created.token.publicId, runtimePrisma);

      await expect(
        transitionBranchToken({
          organizationId: salon.organizationId,
          branchId: salon.branchId,
          tokenId: scope.id,
          action: "COMPLETE",
          actorType: "OWNER",
          actorId: salon.ownerClaims.id,
          now: NOW,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("Cannot perform COMPLETE on a token currently in WAITING status.");
    });

    it("forbids re-queuing a token that is not in SKIPPED status", async () => {
      const salon = await seedTestSalon("RequeueInvalidStatusTest");

      const created = await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: "Neha Kapoor",
        mobileNumber: "9911223344",
        serviceIds: [salon.haircutServiceId],
        now: NOW,
        client: runtimePrisma,
      });

      const scope = await resolvePublicTokenScope(created.token.publicId, runtimePrisma);
      const ownerCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "QUEUE_SKIP",
        branchId: salon.branchId,
        client: runtimePrisma,
      });

      // WAITING -> requeue must be rejected
      await expect(
        requeueSkippedToken(ownerCtx, salon.branchId, scope.id, {
          now: NOW,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("Only skipped tokens can be re-queued.");
    });

    it("forbids double re-queuing: a skipped token can only be re-queued once", async () => {
      const salon = await seedTestSalon("DoubleRequeueTest");

      const created = await createPublicToken({
        salonSlug: salon.organizationSlug,
        branchSlug: salon.branchSlug,
        fullName: "Karan Johar",
        mobileNumber: "9876501234",
        serviceIds: [salon.haircutServiceId],
        now: NOW,
        client: runtimePrisma,
      });

      const scope = await resolvePublicTokenScope(created.token.publicId, runtimePrisma);
      const ownerCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "QUEUE_SKIP",
        branchId: salon.branchId,
        client: runtimePrisma,
      });

      // Call then Skip
      await callNextToken(ownerCtx, salon.branchId, { now: NOW, client: runtimePrisma });
      await transitionBranchToken({
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        tokenId: scope.id,
        action: "SKIP",
        actorType: "OWNER",
        actorId: salon.ownerClaims.id,
        now: NOW,
        client: runtimePrisma,
      });

      // First re-queue succeeds
      const firstRequeue = await requeueSkippedToken(ownerCtx, salon.branchId, scope.id, {
        now: NOW,
        client: runtimePrisma,
      });
      expect(firstRequeue.requeuedToken.tokenNumber).toBe("A002");

      // Second re-queue on the SAME original token must be rejected
      await expect(
        requeueSkippedToken(ownerCtx, salon.branchId, scope.id, {
          now: NOW,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("This skipped token has already been re-queued.");
    });
  });

  // =========================================================================
  // Feature Group 3: Services Catalog & Branch Overrides Isolation
  // =========================================================================
  describe("3. Services Catalog & Branch Price Overrides Isolation", () => {
    it("ensures branch price overrides are strictly isolated and do not contaminate other branches", async () => {
      const salon = await seedTestSalon("CatalogIsolationTest");

      const ownerCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "BRANCH_MANAGE",
        client: runtimePrisma,
      });

      // Create a second branch: West Branch
      const branch2 = await createBranch(
        ownerCtx,
        {
          name: "West Branch",
          slug: "west",
          timezone: "Asia/Kolkata",
        },
        { now: NOW, client: runtimePrisma },
      );

      // Override Haircut price to 35000 paise at Branch 1 (Main)
      const catalogCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "SERVICE_MANAGE",
        branchId: salon.branchId,
        client: runtimePrisma,
      });

      await upsertBranchServiceOverride(
        catalogCtx,
        salon.branchId,
        salon.haircutServiceId,
        {
          isAvailable: true,
          priceOverrideInPaise: 35000,
        },
        { client: runtimePrisma },
      );

      // Branch 1 effective catalog has price 35000
      const b1Services = await getCachedAvailableBranchServices(
        salon.organizationId,
        salon.branchId,
        runtimePrisma,
      );
      const b1Haircut = b1Services.find((s) => s.serviceId === salon.haircutServiceId);
      expect(b1Haircut?.priceInPaise).toBe(35000);

      // Branch 2 effective catalog retains the original base price: 25000
      const b2Services = await getCachedAvailableBranchServices(
        salon.organizationId,
        branch2.id,
        runtimePrisma,
      );
      const b2Haircut = b2Services.find((s) => s.serviceId === salon.haircutServiceId);
      expect(b2Haircut?.priceInPaise).toBe(25000);
    });
  });

  // =========================================================================
  // Feature Group 4: Staff RBAC & Branch-Level Access Enforcement
  // =========================================================================
  describe("4. Staff RBAC & Branch Isolation", () => {
    it("blocks staff assigned to Branch 1 from performing queue actions on Branch 2", async () => {
      const salon = await seedTestSalon("StaffAccessTest");

      const ownerCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "BRANCH_MANAGE",
        client: runtimePrisma,
      });

      // Create Branch 2
      const branch2 = await createBranch(
        ownerCtx,
        {
          name: "South Branch",
          slug: "south",
          timezone: "Asia/Kolkata",
        },
        { now: NOW, client: runtimePrisma },
      );

      // Invite staff member restricted to Branch 1 only
      const rolesRes = await adminTestPrisma.staffRole.findFirstOrThrow({
        where: { organizationId: salon.organizationId, slug: "STAFF" },
      });

      const invite = await createStaffInvite(
        ownerCtx,
        {
          name: "Siddharth Staff",
          email: "siddharth@example.com",
          roleId: rolesRes.id,
          allBranches: false,
          branchIds: [salon.branchId], // Access ONLY to Main Branch
        },
        { now: NOW, client: runtimePrisma },
      );

      // Accept invite
      const rawToken = invite.invitePath.replace("/invite/", "");
      await acceptStaffInvite(rawToken, {
        password: "StaffPassword123!",
      }, { now: NOW, client: runtimePrisma });

      const staffUser = await adminTestPrisma.user.findUniqueOrThrow({
        where: { email: "siddharth@example.com" },
      });

      const staffClaims: SessionUserClaims = {
        id: staffUser.id,
        email: staffUser.email,
        name: staffUser.name,
        activeOrganizationId: salon.organizationId,
        sessionVersion: staffUser.sessionVersion,
        isPlatformAdmin: false,
      };

      // Staff accessing Branch 1 passes
      const b1Ctx = await authorizeTenantAction({
        session: staffClaims,
        requiredPermission: "QUEUE_VIEW",
        branchId: salon.branchId,
        client: runtimePrisma,
      });
      expect(b1Ctx.branchId).toBe(salon.branchId);

      // Staff accessing Branch 2 MUST throw ForbiddenError (BRANCH_ACCESS_DENIED)
      await expect(
        authorizeTenantAction({
          session: staffClaims,
          requiredPermission: "QUEUE_VIEW",
          branchId: branch2.id,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("You do not have access to this branch.");
    });

    it("prevents a user from revoking their own membership", async () => {
      const salon = await seedTestSalon("SelfRevokeTest");

      const ownerMember = await adminTestPrisma.organizationMember.findFirstOrThrow({
        where: { organizationId: salon.organizationId, userId: salon.ownerClaims.id },
      });

      const ownerCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "STAFF_MANAGE",
        client: runtimePrisma,
      });

      await expect(
        revokeStaffMember(ownerCtx, ownerMember.id, { now: NOW, client: runtimePrisma }),
      ).rejects.toThrow("You cannot revoke your own access.");
    });
  });

  // =========================================================================
  // Feature Group 5: Waiting Time Engine Edge Cases
  // =========================================================================
  describe("5. Waiting Time Engine Edge Cases", () => {
    it("handles 0 active tokens gracefully with 0 wait time and 0 people ahead", async () => {
      const salon = await seedTestSalon("WaitEngineEmptyTest");

      const snapshot = await adminTestPrisma.$transaction(async (tx) => {
        return computeBranchWaitSnapshot(tx, {
          organizationId: salon.organizationId,
          branchId: salon.branchId,
          businessDate: NOW,
          activeStationsCount: 2,
          now: NOW,
        });
      });

      expect(snapshot.waitingCount).toBe(0);
      expect(snapshot.estimatedNewJoinWaitMinutes).toBe(0);
      expect(snapshot.byTokenId.size).toBe(0);
      expect(snapshot.overrunFactor).toBe(1.0);
    });
  });

  // =========================================================================
  // Feature Group 6: Analytics & Reporting Edge Cases
  // =========================================================================
  describe("6. Analytics Reporting Zero-Division & PII Safety", () => {
    it("handles zero-token branch cleanly with 0s and zero NaN/Infinity values", async () => {
      const salon = await seedTestSalon("AnalyticsZeroTest");

      const ownerCtx = await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "ANALYTICS_VIEW",
        branchId: salon.branchId,
        client: runtimePrisma,
      });

      const report = await getTenantAnalytics(
        ownerCtx,
        { range: "today", branchId: salon.branchId },
        { client: runtimePrisma },
      );

      expect(report.summary.totalTokens).toBe(0);
      expect(report.summary.completedTokens).toBe(0);
      expect(report.summary.averageWaitMinutes).toBe(0);
      expect(report.summary.averageServiceDurationMinutes).toBe(0);
      expect(Number.isNaN(report.summary.averageWaitMinutes)).toBe(false);
      expect(Number.isFinite(report.summary.averageWaitMinutes)).toBe(true);
      expect(report.topServices).toHaveLength(0);
    });
  });

  // =========================================================================
  // Feature Group 7: Platform Administration & Tenant Suspension
  // =========================================================================
  describe("7. Platform Administration Invariants", () => {
    it("suspending an organization immediately blocks public intake and session invalidates members", async () => {
      const salon = await seedTestSalon("AdminSuspendTest");

      // Platform admin context
      const adminCtx = {
        userId: "admin-uuid-1",
        email: "admin@salonflow.internal",
        name: "Platform Operator",
        isPlatformAdmin: true as const,
      };

      // 1. Suspend tenant
      await updateTenantStatus(
        adminCtx,
        salon.organizationId,
        { status: "SUSPENDED", reason: "Policy violation investigation" },
        { client: runtimePrisma },
      );

      // 2. Public intake snapshot immediately reports TENANT_SUSPENDED
      const identity = await resolvePublicBranchIdentity(
        salon.organizationSlug,
        salon.branchSlug,
        runtimePrisma,
      );
      expect(identity.organization.status).toBe("SUSPENDED");

      await expect(
        createPublicToken({
          salonSlug: salon.organizationSlug,
          branchSlug: salon.branchSlug,
          fullName: "Customer Under Suspended",
          mobileNumber: "9876543210",
          serviceIds: [salon.haircutServiceId],
          now: NOW,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("This salon is currently unavailable.");

      // 3. User sessionVersion was incremented so old JWT is invalidated
      const userAfterSuspend = await adminTestPrisma.user.findUniqueOrThrow({
        where: { id: salon.ownerClaims.id },
      });
      expect(userAfterSuspend.sessionVersion).toBeGreaterThan(salon.ownerClaims.sessionVersion);

      // Old session claims now throw ForbiddenError (TENANT_SUSPENDED)
      await expect(
        authorizeTenantAction({
          session: salon.ownerClaims,
          branchId: salon.branchId,
          client: runtimePrisma,
        }),
      ).rejects.toThrow("Your salon organization account is currently suspended or inactive.");

      // 4. Platform overview and tenant list strictly exclude customer PII
      const overview = await getPlatformOverview(adminCtx, runtimePrisma);
      expect(overview.organizations.total).toBeGreaterThanOrEqual(1);

      const tenantsList = await listTenants(
        adminCtx,
        { page: 1, limit: 10, status: "ALL" },
        runtimePrisma,
      );
      const suspendedItem = tenantsList.items.find((t) => t.id === salon.organizationId);
      expect(suspendedItem?.status).toBe("SUSPENDED");
      // Verify no customer names or numbers exist on tenant DTO
      expect(
        (suspendedItem as unknown as Record<string, unknown>).customerMobile,
      ).toBeUndefined();
      expect(
        (suspendedItem as unknown as Record<string, unknown>).customerName,
      ).toBeUndefined();
    });
  });
});
