import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { createBranch, updateBranch } from "@/server/services/branch-service";
import { createOrganizationService } from "@/server/services/catalog-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import { createStaffInvite, acceptStaffInvite } from "@/server/services/staff-service";
import { getTenantAnalytics } from "@/server/services/analytics-service";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

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

  const haircut = await createOrganizationService(
    serviceManageCtx,
    {
      name: "Haircut",
      baseDurationMinutes: 20,
      basePriceInPaise: 25000,
      sortOrder: 1,
    },
    { client: runtimePrisma },
  );

  const beardTrim = await createOrganizationService(
    serviceManageCtx,
    {
      name: "Beard Trim",
      baseDurationMinutes: 15,
      basePriceInPaise: 15000,
      sortOrder: 2,
    },
    { client: runtimePrisma },
  );

  return {
    organizationId: reg.organizationId,
    organizationSlug: `${lower}-salon`,
    branchId: reg.branchId,
    branchSlug: "main",
    ownerClaims,
    haircutServiceId: haircut.id,
    beardTrimServiceId: beardTrim.id,
  };
}

describe("Phase 14: Analytics and Reporting Suite", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("IT-ANA-01: accurately computes daily/weekly/monthly token counts, top services, avg wait/service times, and multi-branch comparison scoped to organizationId", async () => {
    const salon = await seedTestSalon("Aura");

    // Create a 2nd branch for multi-branch comparison
    const branchCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "BRANCH_MANAGE",
      client: runtimePrisma,
    });

    const branch2 = await createBranch(
      branchCtx,
      {
        name: "South Branch",
        slug: "south",
        phone: "9876543299",
        city: "Bengaluru",
        timezone: "Asia/Kolkata",
      },
      { client: runtimePrisma },
    );

    // Create a customer record
    const customer = await adminTestPrisma.customer.create({
      data: {
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        name: "Rohit Sharma",
        mobileNumber: "9876543201",
      },
    });

    const day1 = new Date("2026-11-10T10:00:00.000Z");
    const day2 = new Date("2026-11-11T11:00:00.000Z");

    // Token 1 on Branch 1 (Day 1): Completed Haircut
    // created 10:00, called 10:10, started 10:10, completed 10:30 (wait 10m, service 20m, 25000 paise, QR)
    const t1 = await adminTestPrisma.token.create({
      data: {
        publicId: "t1_pub_test_1234567890123456",
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        customerId: customer.id,
        businessDate: new Date("2026-11-10"),
        sequenceNumber: 1,
        tokenNumber: "A001",
        source: "QR",
        customerNameSnapshot: "Rohit Sharma",
        customerMobileSnapshot: "9876543201",
        status: "COMPLETED",
        totalPriceInPaise: 25000,
        totalDurationMinutes: 20,
        createdAt: day1,
        calledAt: new Date(day1.getTime() + 10 * 60_000),
        serviceStartedAt: new Date(day1.getTime() + 10 * 60_000),
        completedAt: new Date(day1.getTime() + 30 * 60_000),
        tokenServices: {
          create: [
            {
              serviceId: salon.haircutServiceId,
              serviceNameSnapshot: "Haircut",
              priceInPaiseSnapshot: 25000,
              durationMinutesSnapshot: 20,
            },
          ],
        },
      },
    });
    expect(t1.id).toBeDefined();

    // Token 2 on Branch 1 (Day 1): Cancelled Beard Trim
    // created 10:15, cancelled 10:25 (15000 paise, WALK_IN)
    await adminTestPrisma.token.create({
      data: {
        publicId: "t2_pub_test_1234567890123456",
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        customerId: customer.id,
        businessDate: new Date("2026-11-10"),
        sequenceNumber: 2,
        tokenNumber: "A002",
        source: "WALK_IN",
        customerNameSnapshot: "Virat Kohli",
        customerMobileSnapshot: "9876543202",
        status: "CANCELLED",
        totalPriceInPaise: 15000,
        totalDurationMinutes: 15,
        createdAt: new Date(day1.getTime() + 15 * 60_000),
        cancelledAt: new Date(day1.getTime() + 25 * 60_000),
        tokenServices: {
          create: [
            {
              serviceId: salon.beardTrimServiceId,
              serviceNameSnapshot: "Beard Trim",
              priceInPaiseSnapshot: 15000,
              durationMinutesSnapshot: 15,
            },
          ],
        },
      },
    });

    // Token 3 on Branch 1 (Day 2): Completed Combo (Haircut + Beard Trim)
    // created 11:00, called 11:20, started 11:20, completed 11:55 (wait 20m, service 35m, 40000 paise, QR)
    await adminTestPrisma.token.create({
      data: {
        publicId: "t3_pub_test_1234567890123456",
        organizationId: salon.organizationId,
        branchId: salon.branchId,
        customerId: customer.id,
        businessDate: new Date("2026-11-11"),
        sequenceNumber: 1,
        tokenNumber: "A001",
        source: "QR",
        customerNameSnapshot: "KL Rahul",
        customerMobileSnapshot: "9876543203",
        status: "COMPLETED",
        totalPriceInPaise: 40000,
        totalDurationMinutes: 35,
        createdAt: day2,
        calledAt: new Date(day2.getTime() + 20 * 60_000),
        serviceStartedAt: new Date(day2.getTime() + 20 * 60_000),
        completedAt: new Date(day2.getTime() + 55 * 60_000),
        tokenServices: {
          create: [
            {
              serviceId: salon.haircutServiceId,
              serviceNameSnapshot: "Haircut",
              priceInPaiseSnapshot: 25000,
              durationMinutesSnapshot: 20,
            },
            {
              serviceId: salon.beardTrimServiceId,
              serviceNameSnapshot: "Beard Trim",
              priceInPaiseSnapshot: 15000,
              durationMinutesSnapshot: 15,
            },
          ],
        },
      },
    });

    // Customer on Branch 2
    const customer2 = await adminTestPrisma.customer.create({
      data: {
        organizationId: salon.organizationId,
        branchId: branch2.id,
        name: "Hardik Pandya",
        mobileNumber: "9876543204",
      },
    });

    // Token 4 on Branch 2 (Day 2): Completed Haircut
    // created 12:00, called 12:05, started 12:05, completed 12:25 (wait 5m, service 20m, 25000 paise, WALK_IN)
    await adminTestPrisma.token.create({
      data: {
        publicId: "t4_pub_test_1234567890123456",
        organizationId: salon.organizationId,
        branchId: branch2.id,
        customerId: customer2.id,
        businessDate: new Date("2026-11-11"),
        sequenceNumber: 1,
        tokenNumber: "A001",
        source: "WALK_IN",
        customerNameSnapshot: "Hardik Pandya",
        customerMobileSnapshot: "9876543204",
        status: "COMPLETED",
        totalPriceInPaise: 25000,
        totalDurationMinutes: 20,
        createdAt: new Date("2026-11-11T12:00:00.000Z"),
        calledAt: new Date("2026-11-11T12:05:00.000Z"),
        serviceStartedAt: new Date("2026-11-11T12:05:00.000Z"),
        completedAt: new Date("2026-11-11T12:25:00.000Z"),
        tokenServices: {
          create: [
            {
              serviceId: salon.haircutServiceId,
              serviceNameSnapshot: "Haircut",
              priceInPaiseSnapshot: 25000,
              durationMinutesSnapshot: 20,
            },
          ],
        },
      },
    });

    // Token 5 on Branch 2 (Day 2): No-Show Beard Trim
    // created 12:10, no-show 12:30 (15000 paise, QR)
    await adminTestPrisma.token.create({
      data: {
        publicId: "t5_pub_test_1234567890123456",
        organizationId: salon.organizationId,
        branchId: branch2.id,
        customerId: customer2.id,
        businessDate: new Date("2026-11-11"),
        sequenceNumber: 2,
        tokenNumber: "A002",
        source: "QR",
        customerNameSnapshot: "Shubman Gill",
        customerMobileSnapshot: "9876543205",
        status: "NO_SHOW",
        totalPriceInPaise: 15000,
        totalDurationMinutes: 15,
        createdAt: new Date("2026-11-11T12:10:00.000Z"),
        noShowAt: new Date("2026-11-11T12:30:00.000Z"),
        tokenServices: {
          create: [
            {
              serviceId: salon.beardTrimServiceId,
              serviceNameSnapshot: "Beard Trim",
              priceInPaiseSnapshot: 15000,
              durationMinutesSnapshot: 15,
            },
          ],
        },
      },
    });

    const analyticsCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "ANALYTICS_VIEW",
      client: runtimePrisma,
    });

    // 1. Query full tenant range across all branches
    const report = await getTenantAnalytics(
      analyticsCtx,
      {
        range: "custom",
        from: "2026-11-10",
        to: "2026-11-11",
        granularity: "day",
      },
      { client: runtimePrisma },
    );

    // Verify Overall Summary
    expect(report.summary.totalTokens).toBe(5);
    expect(report.summary.completedTokens).toBe(3);
    expect(report.summary.cancelledTokens).toBe(1);
    expect(report.summary.noShowTokens).toBe(1);
    expect(report.summary.completionRate).toBe(60); // 3 / 5 = 60%
    expect(report.summary.walkInTokensCount).toBe(2);
    expect(report.summary.qrTokensCount).toBe(3);
    // Revenue from completed: t1(25000) + t3(40000) + t4(25000) = 90000 paise
    expect(report.summary.totalRevenuePaise).toBe(90000);
    // Avg wait: (10 + 20 + 5) / 3 = 11.666 -> 11.7m
    expect(report.summary.averageWaitMinutes).toBe(11.7);
    // Avg service: (20 + 35 + 20) / 3 = 25m
    expect(report.summary.averageServiceDurationMinutes).toBe(25);

    // Verify Top Services
    expect(report.topServices.length).toBe(2);
    const haircutStat = report.topServices.find((s) => s.serviceName === "Haircut");
    const beardStat = report.topServices.find((s) => s.serviceName === "Beard Trim");

    expect(haircutStat).toBeDefined();
    expect(haircutStat?.tokenCount).toBe(3); // t1, t3, t4
    expect(haircutStat?.totalRevenuePaise).toBe(75000); // 3 * 25000

    expect(beardStat).toBeDefined();
    expect(beardStat?.tokenCount).toBe(3); // t2, t3, t5
    expect(beardStat?.totalRevenuePaise).toBe(45000); // 3 * 15000

    // Verify Daily Trends
    expect(report.trends.length).toBe(2);
    const day1Trend = report.trends.find((t) => t.periodKey === "2026-11-10");
    const day2Trend = report.trends.find((t) => t.periodKey === "2026-11-11");

    expect(day1Trend?.totalTokens).toBe(2);
    expect(day1Trend?.completedTokens).toBe(1);
    expect(day1Trend?.cancelledTokens).toBe(1);
    expect(day1Trend?.totalRevenuePaise).toBe(25000);

    expect(day2Trend?.totalTokens).toBe(3);
    expect(day2Trend?.completedTokens).toBe(2);
    expect(day2Trend?.noShowTokens).toBe(1);
    expect(day2Trend?.totalRevenuePaise).toBe(65000); // t3(40000) + t4(25000)

    // Verify Multi-Branch Comparison
    expect(report.branches.length).toBe(2);
    const branch1Stat = report.branches.find((b) => b.branchId === salon.branchId);
    const branch2Stat = report.branches.find((b) => b.branchId === branch2.id);

    expect(branch1Stat?.totalTokens).toBe(3);
    expect(branch1Stat?.completedTokens).toBe(2);
    expect(branch1Stat?.cancelledTokens).toBe(1);
    expect(branch1Stat?.totalRevenuePaise).toBe(65000);
    expect(branch1Stat?.completionRate).toBe(66.7);

    expect(branch2Stat?.totalTokens).toBe(2);
    expect(branch2Stat?.completedTokens).toBe(1);
    expect(branch2Stat?.noShowTokens).toBe(1);
    expect(branch2Stat?.totalRevenuePaise).toBe(25000);
    expect(branch2Stat?.completionRate).toBe(50);

    // 2. Query single branch filter (Branch 2 only)
    const branch2Report = await getTenantAnalytics(
      analyticsCtx,
      {
        range: "custom",
        from: "2026-11-10",
        to: "2026-11-11",
        branchId: branch2.id,
      },
      { client: runtimePrisma },
    );

    expect(branch2Report.summary.totalTokens).toBe(2);
    expect(branch2Report.summary.completedTokens).toBe(1);
    expect(branch2Report.summary.noShowTokens).toBe(1);
    expect(branch2Report.summary.totalRevenuePaise).toBe(25000);
    expect(branch2Report.branches.length).toBe(1);
    expect(branch2Report.branches[0]?.branchId).toBe(branch2.id);
  });

  it("enforces cross-tenant isolation: querying an alien salon's branch throws NotFoundError", async () => {
    const salonA = await seedTestSalon("SalonA");
    const salonB = await seedTestSalon("SalonB");

    const analyticsCtxA = await authorizeTenantAction({
      session: salonA.ownerClaims,
      requiredPermission: "ANALYTICS_VIEW",
      client: runtimePrisma,
    });

    // Tenant A attempts to query Tenant B's branch analytics
    await expect(
      getTenantAnalytics(
        analyticsCtxA,
        {
          range: "7d",
          branchId: salonB.branchId,
        },
        { client: runtimePrisma },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("enforces Staff RBAC & Branch Scoping: staff without ANALYTICS_VIEW is rejected; staff with branch assignment sees only permitted branch", async () => {
    const salon = await seedTestSalon("RbacSalon");

    // Create 2nd branch
    const branchManageCtx = await authorizeTenantAction({
      session: salon.ownerClaims,
      requiredPermission: "BRANCH_MANAGE",
      client: runtimePrisma,
    });
    const branch2 = await createBranch(
      branchManageCtx,
      {
        name: "Second Branch",
        slug: "second",
        city: "Mumbai",
        timezone: "Asia/Kolkata",
      },
      { client: runtimePrisma },
    );

    // 1. Staff role with only queue permissions (default STAFF role has no ANALYTICS_VIEW)
    const queueOnlyRole = await adminTestPrisma.staffRole.findFirstOrThrow({
      where: { organizationId: salon.organizationId, slug: "STAFF" },
    });

    const inviteQueue = await createStaffInvite(
      await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "STAFF_MANAGE",
        client: runtimePrisma,
      }),
      {
        name: "Pooja Operator",
        email: "pooja@rbacsalon.test",
        roleId: queueOnlyRole.id,
        allBranches: false,
        branchIds: [salon.branchId],
      },
      { client: runtimePrisma },
    );

    const rawTokenQueue = inviteQueue.invitePath.replace("/invite/", "");
    await acceptStaffInvite(
      rawTokenQueue,
      { password: "StrongPassword!123" },
      { client: runtimePrisma },
    );

    const queueUser = await adminTestPrisma.user.findUniqueOrThrow({
      where: { email: "pooja@rbacsalon.test" },
    });

    const queueStaffClaims: SessionUserClaims = {
      id: queueUser.id,
      email: queueUser.email,
      name: queueUser.name,
      isPlatformAdmin: false,
      sessionVersion: queueUser.sessionVersion,
      activeOrganizationId: salon.organizationId,
    };

    // Attempting to authorize for ANALYTICS_VIEW must fail with ForbiddenError
    await expect(
      authorizeTenantAction({
        session: queueStaffClaims,
        requiredPermission: "ANALYTICS_VIEW",
        client: runtimePrisma,
      }),
    ).rejects.toThrow(ForbiddenError);

    // 2. Manager role with ANALYTICS_VIEW assigned strictly to Branch 1
    const analyticsRole = await adminTestPrisma.staffRole.findFirstOrThrow({
      where: { organizationId: salon.organizationId, slug: "MANAGER" },
    });

    const inviteAnalyst = await createStaffInvite(
      await authorizeTenantAction({
        session: salon.ownerClaims,
        requiredPermission: "STAFF_MANAGE",
        client: runtimePrisma,
      }),
      {
        name: "Amit Analyst",
        email: "amit@rbacsalon.test",
        roleId: analyticsRole.id,
        allBranches: false,
        branchIds: [salon.branchId],
      },
      { client: runtimePrisma },
    );

    const rawTokenAnalyst = inviteAnalyst.invitePath.replace("/invite/", "");
    await acceptStaffInvite(
      rawTokenAnalyst,
      { password: "StrongPassword!123" },
      { client: runtimePrisma },
    );

    const analystUser = await adminTestPrisma.user.findUniqueOrThrow({
      where: { email: "amit@rbacsalon.test" },
    });

    const analystStaffClaims: SessionUserClaims = {
      id: analystUser.id,
      email: analystUser.email,
      name: analystUser.name,
      isPlatformAdmin: false,
      sessionVersion: analystUser.sessionVersion,
      activeOrganizationId: salon.organizationId,
    };

    const analystCtx = await authorizeTenantAction({
      session: analystStaffClaims,
      requiredPermission: "ANALYTICS_VIEW",
      client: runtimePrisma,
    });

    // Querying assigned Branch 1 succeeds
    const branch1Report = await getTenantAnalytics(
      analystCtx,
      {
        range: "7d",
        branchId: salon.branchId,
      },
      { client: runtimePrisma },
    );
    expect(branch1Report.summary.totalTokens).toBe(0);

    // Querying unassigned Branch 2 throws ForbiddenError
    await expect(
      getTenantAnalytics(
        analystCtx,
        {
          range: "7d",
          branchId: branch2.id,
        },
        { client: runtimePrisma },
      ),
    ).rejects.toThrow(ForbiddenError);

    // Querying all branches ("all") restricts branches list strictly to assigned Branch 1
    const allReport = await getTenantAnalytics(
      analystCtx,
      {
        range: "7d",
      },
      { client: runtimePrisma },
    );
    expect(allReport.branches.length).toBe(1);
    expect(allReport.branches[0]?.branchId).toBe(salon.branchId);
  });
});
