import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import {
  PERMISSION_KEYS,
  authenticateWithCredentials,
  authorizeTenantAction,
  hashPassword,
  requirePlatformAdmin,
  type SessionUserClaims,
} from "@/server/auth";
import { changeUserPassword } from "@/server/services/account-service";

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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 2 auth/RBAC tests",
  );
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

const IDS = {
  adminUser: "10000000-0000-4000-8000-000000000001",
  orgA: "aaaaaaaa-0000-4000-8000-000000000100",
  ownerAUser: "aaaaaaaa-0000-4000-8000-000000000101",
  staffAUser: "aaaaaaaa-0000-4000-8000-000000000102",
  unverifiedUser: "aaaaaaaa-0000-4000-8000-000000000103",
  roleAOwner: "aaaaaaaa-0000-4000-8000-000000000111",
  roleAStaff: "aaaaaaaa-0000-4000-8000-000000000112",
  branchA1: "aaaaaaaa-0000-4000-8000-000000000121",
  branchA2: "aaaaaaaa-0000-4000-8000-000000000122",
  orgB: "bbbbbbbb-0000-4000-8000-000000000200",
  ownerBUser: "bbbbbbbb-0000-4000-8000-000000000201",
  roleBOwner: "bbbbbbbb-0000-4000-8000-000000000211",
  branchB1: "bbbbbbbb-0000-4000-8000-000000000221",
};

const STAFF_PERMS = [
  "QUEUE_VIEW",
  "QUEUE_CREATE_WALKIN",
  "QUEUE_CALL_NEXT",
  "QUEUE_START",
  "QUEUE_COMPLETE",
  "QUEUE_SKIP",
  "QUEUE_CANCEL",
  "QUEUE_NO_SHOW",
  "HISTORY_VIEW",
] as const;

let cachedPasswordHash = "";

async function seedAuthFixtures() {
  if (!cachedPasswordHash) {
    cachedPasswordHash = await hashPassword("Password!2026", 4);
  }

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

  const now = new Date();

  await adminTestPrisma.user.createMany({
    data: [
      {
        id: IDS.adminUser,
        name: "Platform Admin",
        email: "admin@salonflow.test",
        emailVerifiedAt: now,
        passwordHash: cachedPasswordHash,
        isPlatformAdmin: true,
        isActive: true,
      },
      {
        id: IDS.ownerAUser,
        name: "Owner A",
        email: "owner.a@salonflow.test",
        emailVerifiedAt: now,
        passwordHash: cachedPasswordHash,
        isPlatformAdmin: false,
        isActive: true,
      },
      {
        id: IDS.staffAUser,
        name: "Staff A1",
        email: "staff.a1@salonflow.test",
        emailVerifiedAt: now,
        passwordHash: cachedPasswordHash,
        isPlatformAdmin: false,
        isActive: true,
      },
      {
        id: IDS.unverifiedUser,
        name: "Pending Owner",
        email: "pending@salonflow.test",
        emailVerifiedAt: null,
        passwordHash: cachedPasswordHash,
        isPlatformAdmin: false,
        isActive: true,
      },
      {
        id: IDS.ownerBUser,
        name: "Owner B",
        email: "owner.b@salonflow.test",
        emailVerifiedAt: now,
        passwordHash: cachedPasswordHash,
        isPlatformAdmin: false,
        isActive: true,
      },
    ],
  });

  await adminTestPrisma.organization.createMany({
    data: [
      { id: IDS.orgA, name: "Salon A", slug: "salon-a", status: "ACTIVE" },
      { id: IDS.orgB, name: "Salon B", slug: "salon-b", status: "ACTIVE" },
    ],
  });

  await adminTestPrisma.staffRole.createMany({
    data: [
      { id: IDS.roleAOwner, organizationId: IDS.orgA, name: "Owner", slug: "OWNER" },
      { id: IDS.roleAStaff, organizationId: IDS.orgA, name: "Staff", slug: "STAFF" },
      { id: IDS.roleBOwner, organizationId: IDS.orgB, name: "Owner", slug: "OWNER" },
    ],
  });

  await adminTestPrisma.rolePermission.createMany({
    data: [
      ...PERMISSION_KEYS.map((permissionKey) => ({
        organizationId: IDS.orgA,
        staffRoleId: IDS.roleAOwner,
        permissionKey,
      })),
      ...STAFF_PERMS.map((permissionKey) => ({
        organizationId: IDS.orgA,
        staffRoleId: IDS.roleAStaff,
        permissionKey,
      })),
      ...PERMISSION_KEYS.map((permissionKey) => ({
        organizationId: IDS.orgB,
        staffRoleId: IDS.roleBOwner,
        permissionKey,
      })),
    ],
  });

  await adminTestPrisma.branch.createMany({
    data: [
      {
        id: IDS.branchA1,
        organizationId: IDS.orgA,
        name: "Branch A1",
        slug: "branch-a1",
        qrToken: "qr_a1",
      },
      {
        id: IDS.branchA2,
        organizationId: IDS.orgA,
        name: "Branch A2",
        slug: "branch-a2",
        qrToken: "qr_a2",
      },
      {
        id: IDS.branchB1,
        organizationId: IDS.orgB,
        name: "Branch B1",
        slug: "branch-b1",
        qrToken: "qr_b1",
      },
    ],
  });

  const memberAOwner = await adminTestPrisma.organizationMember.create({
    data: {
      organizationId: IDS.orgA,
      userId: IDS.ownerAUser,
      staffRoleId: IDS.roleAOwner,
      allBranches: true,
      status: "ACTIVE",
    },
  });

  const memberAStaff = await adminTestPrisma.organizationMember.create({
    data: {
      organizationId: IDS.orgA,
      userId: IDS.staffAUser,
      staffRoleId: IDS.roleAStaff,
      allBranches: false,
      status: "ACTIVE",
    },
  });

  await adminTestPrisma.organizationMember.create({
    data: {
      organizationId: IDS.orgA,
      userId: IDS.unverifiedUser,
      staffRoleId: IDS.roleAOwner,
      allBranches: true,
      status: "ACTIVE",
    },
  });

  await adminTestPrisma.organizationMember.create({
    data: {
      organizationId: IDS.orgB,
      userId: IDS.ownerBUser,
      staffRoleId: IDS.roleBOwner,
      allBranches: true,
      status: "ACTIVE",
    },
  });

  // Staff A1 assigned ONLY to Branch A1
  await adminTestPrisma.staffBranchAccess.create({
    data: {
      organizationId: IDS.orgA,
      memberId: memberAStaff.id,
      branchId: IDS.branchA1,
    },
  });

  expect(memberAOwner.id).toBeTruthy();
}

function sessionFor(
  userId: string,
  activeOrganizationId: string | null,
  overrides: Partial<SessionUserClaims> = {},
): SessionUserClaims {
  return {
    id: userId,
    email: "user@salonflow.test",
    name: "Test User",
    activeOrganizationId,
    sessionVersion: 1,
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe("Phase 2 Authentication, Lockout, RBAC & Tenant Isolation", () => {
  beforeAll(async () => {
    await seedAuthFixtures();
  });

  beforeEach(async () => {
    await seedAuthFixtures();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("authenticates verified users (case-insensitive email) and blocks unverified accounts", async () => {
    const ok = await authenticateWithCredentials({
      email: "  OWNER.A@SalonFlow.Test ",
      password: "Password!2026",
      client: runtimePrisma,
    });

    expect(ok).toEqual({
      ok: true,
      user: {
        id: IDS.ownerAUser,
        email: "owner.a@salonflow.test",
        name: "Owner A",
        activeOrganizationId: IDS.orgA,
        sessionVersion: 1,
        isPlatformAdmin: false,
      },
    });

    const unverified = await authenticateWithCredentials({
      email: "pending@salonflow.test",
      password: "Password!2026",
      client: runtimePrisma,
    });

    expect(unverified).toEqual({ ok: false, reason: "EMAIL_NOT_VERIFIED" });
  });

  it("enforces 5-attempt 15-minute brute-force lockout, writes LOGIN_LOCKED audit, and unlocks after expiry", async () => {
    const t0 = new Date("2026-11-12T10:00:00.000Z");

    for (let i = 0; i < 4; i += 1) {
      const res = await authenticateWithCredentials({
        email: "owner.a@salonflow.test",
        password: "WrongPassword",
        ipAddressHash: "hash_abc",
        now: t0,
        client: runtimePrisma,
      });
      expect(res).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    }

    // 5th attempt triggers 15-minute lockout + AuditLog
    const fifth = await authenticateWithCredentials({
      email: "owner.a@salonflow.test",
      password: "WrongPassword",
      ipAddressHash: "hash_abc",
      now: t0,
      client: runtimePrisma,
    });
    expect(fifth).toEqual({ ok: false, reason: "ACCOUNT_LOCKED" });

    // Correct password MUST still be rejected during active lockout window
    const duringLockout = await authenticateWithCredentials({
      email: "owner.a@salonflow.test",
      password: "Password!2026",
      now: new Date(t0.getTime() + 5 * 60_000),
      client: runtimePrisma,
    });
    expect(duringLockout).toEqual({ ok: false, reason: "ACCOUNT_LOCKED" });

    const lockLogs = await adminTestPrisma.auditLog.findMany({
      where: { entityId: IDS.ownerAUser, action: "LOGIN_LOCKED" },
    });
    expect(lockLogs).toHaveLength(1);

    // After 15 minutes expire, correct password succeeds and resets counters
    const afterExpiry = await authenticateWithCredentials({
      email: "owner.a@salonflow.test",
      password: "Password!2026",
      now: new Date(t0.getTime() + 16 * 60_000),
      client: runtimePrisma,
    });
    expect(afterExpiry.ok).toBe(true);

    const dbUser = await adminTestPrisma.user.findUniqueOrThrow({
      where: { id: IDS.ownerAUser },
    });
    expect(dbUser.failedLoginAttempts).toBe(0);
    expect(dbUser.lockedUntil).toBeNull();
  });

  it("TI-01: cross-tenant branchId returns 404 RESOURCE_NOT_FOUND (blocks tenant enumeration)", async () => {
    const ownerASession = sessionFor(IDS.ownerAUser, IDS.orgA);

    const err = await authorizeTenantAction({
      requiredPermission: "QUEUE_VIEW",
      branchId: IDS.branchB1, // Belongs to Salon B!
      session: ownerASession,
      client: runtimePrisma,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).statusCode).toBe(404);
  });

  it("TI-03: staff assigned only to Branch A1 receives 403 BRANCH_ACCESS_DENIED for Branch A2", async () => {
    const staffSession = sessionFor(IDS.staffAUser, IDS.orgA);

    const okCtx = await authorizeTenantAction({
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: IDS.branchA1,
      session: staffSession,
      client: runtimePrisma,
    });
    expect(okCtx.branchId).toBe(IDS.branchA1);
    expect(okCtx.allowedBranchIds.has(IDS.branchA1)).toBe(true);

    const deniedErr = await authorizeTenantAction({
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId: IDS.branchA2,
      session: staffSession,
      client: runtimePrisma,
    }).catch((e) => e);

    expect(deniedErr).toBeInstanceOf(ForbiddenError);
    expect((deniedErr as ForbiddenError).code).toBe("BRANCH_ACCESS_DENIED");
    expect((deniedErr as ForbiddenError).statusCode).toBe(403);
  });

  it("IT-RBAC-01: enforces granular Staff RolePermissions across queue vs admin/owner endpoints", async () => {
    const staffSession = sessionFor(IDS.staffAUser, IDS.orgA);

    for (const perm of STAFF_PERMS) {
      const ctx = await authorizeTenantAction({
        requiredPermission: perm,
        branchId: IDS.branchA1,
        session: staffSession,
        client: runtimePrisma,
      });
      expect(ctx.permissions.has(perm)).toBe(true);
    }

    for (const restrictedPerm of [
      "STAFF_MANAGE",
      "BRANCH_MANAGE",
      "SETTINGS_MANAGE",
      "ANALYTICS_VIEW",
      "SERVICE_MANAGE",
      "QR_MANAGE",
    ] as const) {
      const err = await authorizeTenantAction({
        requiredPermission: restrictedPerm,
        session: staffSession,
        client: runtimePrisma,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).code).toBe("FORBIDDEN");
    }
  });

  it("rejects unauthenticated requests (401), password change increments sessionVersion immediately, and blocks suspended tenants (403)", async () => {
    await expect(
      authorizeTenantAction({ session: null, client: runtimePrisma }),
    ).rejects.toThrow(UnauthorizedError);

    const ownerSession = sessionFor(IDS.ownerAUser, IDS.orgA);
    const ctx = await authorizeTenantAction({
      requiredPermission: "SETTINGS_MANAGE",
      session: ownerSession,
      client: runtimePrisma,
    });

    // Wrong current password rejected cleanly
    await expect(
      changeUserPassword({
        ctx,
        currentPassword: "WrongCurrentPassword",
        newPassword: "NewStrongPassword!2026",
        client: runtimePrisma,
      }),
    ).rejects.toThrow(ValidationError);

    // Successful password change rotates sessionVersion -> old JWT immediately invalidated!
    const updated = await changeUserPassword({
      ctx,
      currentPassword: "Password!2026",
      newPassword: "NewStrongPassword!2026",
      client: runtimePrisma,
    });
    expect(updated.sessionVersion).toBe(2);

    await expect(
      authorizeTenantAction({
        session: ownerSession, // still holds sessionVersion: 1
        client: runtimePrisma,
      }),
    ).rejects.toThrow(UnauthorizedError);

    // Updated sessionVersion succeeds until tenant is suspended
    const freshSession = sessionFor(IDS.ownerAUser, IDS.orgA, { sessionVersion: 2 });
    await expect(
      authorizeTenantAction({ session: freshSession, client: runtimePrisma }),
    ).resolves.toMatchObject({ organizationId: IDS.orgA });

    await adminTestPrisma.organization.update({
      where: { id: IDS.orgA },
      data: { status: "SUSPENDED" },
    });

    const suspendedErr = await authorizeTenantAction({
      session: freshSession,
      client: runtimePrisma,
    }).catch((e) => e);
    expect(suspendedErr).toBeInstanceOf(ForbiddenError);
    expect((suspendedErr as ForbiddenError).code).toBe("TENANT_SUSPENDED");
  });

  it("enforces requirePlatformAdmin() strictly against non-admins and revoked sessions", async () => {
    await expect(
      requirePlatformAdmin({ session: null, client: runtimePrisma }),
    ).rejects.toThrow(UnauthorizedError);

    await expect(
      requirePlatformAdmin({
        session: sessionFor(IDS.ownerAUser, IDS.orgA),
        client: runtimePrisma,
      }),
    ).rejects.toThrow(ForbiddenError);

    const adminCtx = await requirePlatformAdmin({
      session: sessionFor(IDS.adminUser, null, { isPlatformAdmin: true }),
      client: runtimePrisma,
    });
    expect(adminCtx).toMatchObject({
      userId: IDS.adminUser,
      isPlatformAdmin: true,
    });

    await expect(
      requirePlatformAdmin({
        session: sessionFor(IDS.adminUser, null, {
          isPlatformAdmin: true,
          sessionVersion: 99,
        }),
        client: runtimePrisma,
      }),
    ).rejects.toThrow(UnauthorizedError);
  });
});
