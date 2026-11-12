import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import {
  authenticateWithCredentials,
  authorizeTenantAction,
  type SessionUserClaims,
} from "@/server/auth";
import {
  createBranch,
  listAccessibleBranches,
  updateBranch,
} from "@/server/services/branch-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from "@/server/services/settings-service";
import {
  acceptStaffInvite,
  createStaffInvite,
  getInvitePreview,
  listStaffAndRoles,
  revokeStaffMember,
} from "@/server/services/staff-service";

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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 4 tests",
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

describe("Phase 4 Onboarding, Branches, Settings & Staff Invites", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("IT-ONB-01: registers salon atomically, blocks duplicates & honeypot, verifies email, and unlocks login", async () => {
    // Bot honeypot trap rejects cleanly with 0 DB writes
    await expect(
      registerSalonOrganization({
        input: {
          ownerName: "Bot User",
          email: "bot@spam.test",
          password: "Password!2026",
          organizationName: "Spam Salon",
          salonSlug: "spam-salon",
          branchName: "Main Branch",
          branchSlug: "main",
          timezone: "Asia/Kolkata",
          website: "https://spam.example",
        },
        client: runtimePrisma,
      }),
    ).rejects.toThrow(ValidationError);

    let capturedVerificationToken = "";
    const created = await registerSalonOrganization({
      input: {
        ownerName: "Neha Kapoor",
        email: "neha@auratest.in",
        password: "OwnerPassword!2026",
        organizationName: "Aura Test Salon",
        salonSlug: "aura-test",
        branchName: "Main Branch",
        branchSlug: "main",
        city: "Bengaluru",
        timezone: "Asia/Kolkata",
        website: "",
      },
      requireAdminApproval: false,
      onVerificationTokenCreated: ({ token }) => {
        capturedVerificationToken = token;
      },
      client: runtimePrisma,
    });

    expect(created.status).toBe("ACTIVE");
    expect(created.salonSlug).toBe("aura-test");
    expect(created.branchSlug).toBe("main");
    expect(capturedVerificationToken.length).toBeGreaterThan(16);

    // Duplicate salonSlug raises 409 SLUG_TAKEN
    const slugErr = await registerSalonOrganization({
      input: {
        ownerName: "Other Owner",
        email: "other@auratest.in",
        password: "OwnerPassword!2026",
        organizationName: "Other Salon",
        salonSlug: "aura-test",
        branchName: "Main Branch",
        branchSlug: "main",
        timezone: "Asia/Kolkata",
        website: "",
      },
      client: runtimePrisma,
    }).catch((e) => e);
    expect(slugErr).toBeInstanceOf(ConflictError);
    expect((slugErr as ConflictError).code).toBe("SLUG_TAKEN");

    // Verify 3 default roles, 7 businessHours, org & branch SalonSettings, and AuditLog exist
    const roles = await adminTestPrisma.staffRole.findMany({
      where: { organizationId: created.organizationId },
      include: { permissions: true },
    });
    expect(roles).toHaveLength(3);
    expect(roles.find((r) => r.slug === "OWNER")?.permissions).toHaveLength(15);

    const hours = await adminTestPrisma.businessHours.findMany({
      where: { branchId: created.branchId },
    });
    expect(hours).toHaveLength(7);

    const orgSettingsCount = await adminTestPrisma.salonSettings.count({
      where: { organizationId: created.organizationId },
    });
    expect(orgSettingsCount).toBe(2); // org default + initial branch

    // Unverified login blocked until email verified
    const preVerifyLogin = await authenticateWithCredentials({
      email: "neha@auratest.in",
      password: "OwnerPassword!2026",
      client: runtimePrisma,
    });
    expect(preVerifyLogin).toEqual({ ok: false, reason: "EMAIL_NOT_VERIFIED" });

    const verified = await verifyEmailToken({
      token: capturedVerificationToken,
      client: runtimePrisma,
    });
    expect(verified).toEqual({ verified: true, email: "neha@auratest.in" });

    // Single-use token: second verification attempt rejected cleanly
    await expect(
      verifyEmailToken({ token: capturedVerificationToken, client: runtimePrisma }),
    ).rejects.toThrow(ValidationError);

    const postVerifyLogin = await authenticateWithCredentials({
      email: "neha@auratest.in",
      password: "OwnerPassword!2026",
      client: runtimePrisma,
    });
    expect(postVerifyLogin.ok).toBe(true);
  });

  it("creates secondary branches inheriting active services, updates 7-day hours/settings, and blocks cross-tenant access", async () => {
    let tokA = "";
    let tokB = "";
    const regA = await registerSalonOrganization({
      input: {
        ownerName: "Owner A",
        email: "ownera@test.in",
        password: "Password!2026",
        organizationName: "Salon A",
        salonSlug: "salon-a-brn",
        branchName: "Koramangala",
        branchSlug: "koramangala",
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
        email: "ownerb@test.in",
        password: "Password!2026",
        organizationName: "Salon B",
        salonSlug: "salon-b-brn",
        branchName: "Bandra",
        branchSlug: "bandra",
        timezone: "Asia/Kolkata",
        website: "",
      },
      onVerificationTokenCreated: ({ token }) => {
        tokB = token;
      },
      client: runtimePrisma,
    });
    await verifyEmailToken({ token: tokB, client: runtimePrisma });

    // Seed an active service for Org A to verify BranchService inheritance on new branch creation
    const svcA = await adminTestPrisma.service.create({
      data: {
        organizationId: regA.organizationId,
        name: "Classic Haircut",
        basePriceInPaise: 30000,
        baseDurationMinutes: 30,
        isActive: true,
      },
    });

    const ownerASession: SessionUserClaims = {
      id: regA.userId,
      email: "ownera@test.in",
      name: "Owner A",
      activeOrganizationId: regA.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };

    const ownerACtx = await authorizeTenantAction({
      requiredPermission: "BRANCH_MANAGE",
      session: ownerASession,
      client: runtimePrisma,
    });

    const newBranch = await createBranch(
      ownerACtx,
      {
        name: "Indiranagar",
        slug: "indiranagar",
        city: "Bengaluru",
        timezone: "Asia/Kolkata",
      },
      { client: runtimePrisma },
    );
    expect(newBranch.businessHours).toHaveLength(7);

    const inheritedBranchServices = await adminTestPrisma.branchService.findMany({
      where: { branchId: newBranch.id },
    });
    expect(inheritedBranchServices.map((bs) => bs.serviceId)).toEqual([svcA.id]);

    // Update branch stations & Sunday hours
    const updated = await updateBranch(
      await authorizeTenantAction({
        requiredPermission: "BRANCH_MANAGE",
        branchId: newBranch.id,
        session: ownerASession,
        client: runtimePrisma,
      }),
      newBranch.id,
      {
        isActive: true,
        businessHours: [
          { dayOfWeek: 0, isOpen: false, openTime: "09:30", closeTime: "21:30" },
        ],
        settings: { activeStationsCount: 4, allowCustomerCancel: false },
      },
      { client: runtimePrisma },
    );
    expect(updated.settings?.activeStationsCount).toBe(4);
    expect(updated.settings?.allowCustomerCancel).toBe(false);
    expect(updated.businessHours.find((h) => h.dayOfWeek === 0)?.isOpen).toBe(false);

    // Org settings read & update
    const settingsCtx = await authorizeTenantAction({
      requiredPermission: "SETTINGS_MANAGE",
      session: ownerASession,
      client: runtimePrisma,
    });
    await updateOrganizationSettings(
      settingsCtx,
      { allowDuplicateActiveTokens: true },
      { client: runtimePrisma },
    );
    const orgSettings = await getOrganizationSettings(settingsCtx, runtimePrisma);
    expect(orgSettings?.allowDuplicateActiveTokens).toBe(true);

    // Cross-tenant branch update blocked with 404 NotFoundError
    await expect(
      authorizeTenantAction({
        requiredPermission: "BRANCH_MANAGE",
        branchId: regB.branchId,
        session: ownerASession,
        client: runtimePrisma,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("invites staff scoped to selected branch, activates via invite link, and revokes session + push subscriptions immediately", async () => {
    let tokA = "";
    const regA = await registerSalonOrganization({
      input: {
        ownerName: "Owner A",
        email: "owner.staff@test.in",
        password: "Password!2026",
        organizationName: "Aura Staff Salon",
        salonSlug: "aura-staff-salon",
        branchName: "Branch 1",
        branchSlug: "branch-1",
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
      email: "owner.staff@test.in",
      name: "Owner A",
      activeOrganizationId: regA.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };

    const branch2 = await createBranch(
      await authorizeTenantAction({
        requiredPermission: "BRANCH_MANAGE",
        session: ownerSession,
        client: runtimePrisma,
      }),
      { name: "Branch 2", slug: "branch-2", timezone: "Asia/Kolkata" },
      { client: runtimePrisma },
    );

    const staffCtx = await authorizeTenantAction({
      requiredPermission: "STAFF_MANAGE",
      session: ownerSession,
      client: runtimePrisma,
    });
    const roster = await listStaffAndRoles(staffCtx, runtimePrisma);
    const staffRoleId = roster.roles.find((r) => r.slug === "STAFF")?.id;
    expect(staffRoleId).toBeTruthy();

    // Invite Suresh scoped ONLY to Branch 1
    const invite = await createStaffInvite(
      staffCtx,
      {
        name: "Suresh Stylist",
        email: "suresh.stylist@test.in",
        roleId: staffRoleId!,
        allBranches: false,
        branchIds: [regA.branchId],
      },
      { client: runtimePrisma },
    );
    const rawToken = invite.invitePath.replace("/invite/", "");

    const preview = await getInvitePreview(rawToken, new Date(), runtimePrisma);
    expect(preview.organizationName).toBe("Aura Staff Salon");
    expect(preview.roleName).toBe("Staff");

    await acceptStaffInvite(
      rawToken,
      { name: "Suresh Stylist", password: "StaffPassword!2026" },
      { client: runtimePrisma },
    );

    // Single-use invite rejected on second view
    await expect(getInvitePreview(rawToken, new Date(), runtimePrisma)).rejects.toThrow(
      NotFoundError,
    );

    // Staff can sign in and access ONLY Branch 1
    const staffLogin = await authenticateWithCredentials({
      email: "suresh.stylist@test.in",
      password: "StaffPassword!2026",
      client: runtimePrisma,
    });
    expect(staffLogin.ok).toBe(true);
    if (!staffLogin.ok) throw new Error("Expected login success");

    const staffBranch1Ctx = await authorizeTenantAction({
      requiredPermission: "QUEUE_VIEW",
      branchId: regA.branchId,
      session: staffLogin.user,
      client: runtimePrisma,
    });
    const accessible = await listAccessibleBranches(staffBranch1Ctx, runtimePrisma);
    expect(accessible.map((b) => b.id)).toEqual([regA.branchId]);

    await expect(
      authorizeTenantAction({
        requiredPermission: "QUEUE_VIEW",
        branchId: branch2.id,
        session: staffLogin.user,
        client: runtimePrisma,
      }),
    ).rejects.toThrow();

    // Create an active push subscription for the staff user to confirm revocation disables it
    await adminTestPrisma.pushSubscription.create({
      data: {
        organizationId: regA.organizationId,
        branchId: regA.branchId,
        subscriberType: "OWNER_STAFF",
        userId: staffLogin.user.id,
        endpoint: "https://fcm.googleapis.com/fcm/send/staff-device-1",
        p256dh: "p256dh_key_value",
        auth: "auth_secret_value",
        isActive: true,
      },
    });

    // Owner revokes staff member -> sessionVersion increments & push deactivated immediately!
    await revokeStaffMember(
      await authorizeTenantAction({
        requiredPermission: "STAFF_MANAGE",
        session: ownerSession,
        client: runtimePrisma,
      }),
      invite.memberId,
      { client: runtimePrisma },
    );

    await expect(
      authorizeTenantAction({
        requiredPermission: "QUEUE_VIEW",
        branchId: regA.branchId,
        session: staffLogin.user,
        client: runtimePrisma,
      }),
    ).rejects.toThrow(UnauthorizedError);

    const activeSubsAfterRevoke = await adminTestPrisma.pushSubscription.count({
      where: { userId: staffLogin.user.id, isActive: true },
    });
    expect(activeSubsAfterRevoke).toBe(0);
  });
});
