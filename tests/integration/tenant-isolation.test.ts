import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystemDb } from "@/server/db/system-db";
import { TenantContextError, withBranchDb, withTenantDb } from "@/server/db/tenant-db";

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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run TI-05 tests",
  );
}

// Derive admin URL specifically for test fixture setup in salonflow_test
const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

// Single-connection pooled runtime client to prove pooled connections never leak context
const runtimePoolUrl = TEST_RUNTIME_URL.includes("?")
  ? `${TEST_RUNTIME_URL}&connection_limit=1`
  : `${TEST_RUNTIME_URL}?connection_limit=1`;

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: runtimePoolUrl } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

const FIXTURE = {
  orgA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0",
  orgB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0",
  branchA1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  branchA2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  branchB1: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  serviceA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11",
  serviceB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11",
  customerA1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21",
  customerA2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22",
  customerB1: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb21",
  tokenA1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa31",
  tokenA2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa32",
  tokenB1: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb31",
};

const BIZ_DATE = new Date(Date.UTC(2026, 10, 12));

describe("TI-05: Multi-Tenant Database Isolation, RLS, Composite FKs & Pooling", () => {
  beforeAll(async () => {
    // Cleanly reset test fixtures in salonflow_test via admin connection
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

    await adminTestPrisma.organization.createMany({
      data: [
        { id: FIXTURE.orgA, name: "Org A Salon", slug: "org-a-test", status: "ACTIVE" },
        { id: FIXTURE.orgB, name: "Org B Salon", slug: "org-b-test", status: "ACTIVE" },
      ],
    });

    await adminTestPrisma.branch.createMany({
      data: [
        {
          id: FIXTURE.branchA1,
          organizationId: FIXTURE.orgA,
          name: "Branch A1",
          slug: "a1",
          qrToken: "qr_a1",
        },
        {
          id: FIXTURE.branchA2,
          organizationId: FIXTURE.orgA,
          name: "Branch A2",
          slug: "a2",
          qrToken: "qr_a2",
        },
        {
          id: FIXTURE.branchB1,
          organizationId: FIXTURE.orgB,
          name: "Branch B1",
          slug: "b1",
          qrToken: "qr_b1",
        },
      ],
    });

    await adminTestPrisma.service.createMany({
      data: [
        {
          id: FIXTURE.serviceA,
          organizationId: FIXTURE.orgA,
          name: "Org A Haircut",
          basePriceInPaise: 30000,
          baseDurationMinutes: 30,
        },
        {
          id: FIXTURE.serviceB,
          organizationId: FIXTURE.orgB,
          name: "Org B Haircut",
          basePriceInPaise: 40000,
          baseDurationMinutes: 35,
        },
      ],
    });

    await adminTestPrisma.customer.createMany({
      data: [
        {
          id: FIXTURE.customerA1,
          organizationId: FIXTURE.orgA,
          branchId: FIXTURE.branchA1,
          name: "Cust A1",
          mobileNumber: "9800000001",
        },
        {
          id: FIXTURE.customerA2,
          organizationId: FIXTURE.orgA,
          branchId: FIXTURE.branchA2,
          name: "Cust A2",
          mobileNumber: "9800000002",
        },
        {
          id: FIXTURE.customerB1,
          organizationId: FIXTURE.orgB,
          branchId: FIXTURE.branchB1,
          name: "Cust B1",
          mobileNumber: "9800000003",
        },
      ],
    });

    await adminTestPrisma.token.createMany({
      data: [
        {
          id: FIXTURE.tokenA1,
          publicId: "test_pub_a1",
          organizationId: FIXTURE.orgA,
          branchId: FIXTURE.branchA1,
          customerId: FIXTURE.customerA1,
          businessDate: BIZ_DATE,
          sequenceNumber: 1,
          tokenNumber: "A001",
          customerNameSnapshot: "Cust A1",
          customerMobileSnapshot: "9800000001",
          totalPriceInPaise: 30000,
          totalDurationMinutes: 30,
        },
        {
          id: FIXTURE.tokenA2,
          publicId: "test_pub_a2",
          organizationId: FIXTURE.orgA,
          branchId: FIXTURE.branchA2,
          customerId: FIXTURE.customerA2,
          businessDate: BIZ_DATE,
          sequenceNumber: 1,
          tokenNumber: "A001",
          customerNameSnapshot: "Cust A2",
          customerMobileSnapshot: "9800000002",
          totalPriceInPaise: 30000,
          totalDurationMinutes: 30,
        },
        {
          id: FIXTURE.tokenB1,
          publicId: "test_pub_b1",
          organizationId: FIXTURE.orgB,
          branchId: FIXTURE.branchB1,
          customerId: FIXTURE.customerB1,
          businessDate: BIZ_DATE,
          sequenceNumber: 1,
          tokenNumber: "A001",
          customerNameSnapshot: "Cust B1",
          customerMobileSnapshot: "9800000003",
          totalPriceInPaise: 40000,
          totalDurationMinutes: 35,
        },
      ],
    });
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("11. verifies runtime DB role is app_runtime (non-superuser, NOBYPASSRLS)", async () => {
    const rows = await runtimePrisma.$queryRaw<
      Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
    >`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(rows[0]).toEqual({
      rolname: "app_runtime",
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it("1 & 2. Organization A and Organization B can each read their own records via withTenantDb", async () => {
    const orgATokens = await withTenantDb(
      FIXTURE.orgA,
      (tx) => tx.token.findMany({ orderBy: { publicId: "asc" } }),
      runtimePrisma,
    );
    expect(orgATokens.map((t) => t.id)).toEqual([FIXTURE.tokenA1, FIXTURE.tokenA2]);

    const orgBTokens = await withTenantDb(
      FIXTURE.orgB,
      (tx) => tx.token.findMany(),
      runtimePrisma,
    );
    expect(orgBTokens.map((t) => t.id)).toEqual([FIXTURE.tokenB1]);
  });

  it("3. Organization A cannot read Organization B records even without WHERE organizationId", async () => {
    await withTenantDb(
      FIXTURE.orgA,
      async (tx) => {
        const services = await tx.service.findMany();
        const foundBToken = await tx.token.findUnique({ where: { id: FIXTURE.tokenB1 } });
        const customers = await tx.customer.findMany();

        expect(services.every((s) => s.organizationId === FIXTURE.orgA)).toBe(true);
        expect(foundBToken).toBeNull();
        expect(customers.some((c) => c.organizationId === FIXTURE.orgB)).toBe(false);
      },
      runtimePrisma,
    );
  });

  it("4 & 5. Organization A cannot update or delete Organization B records", async () => {
    await withTenantDb(
      FIXTURE.orgA,
      async (tx) => {
        const updated = await tx.service.updateMany({
          where: { id: FIXTURE.serviceB },
          data: { name: "Tampered Name" },
        });
        expect(updated.count).toBe(0);

        const deleted = await tx.token.deleteMany({
          where: { id: FIXTURE.tokenB1 },
        });
        expect(deleted.count).toBe(0);

        // Attempt cross-tenant INSERT under Org A context -> rejected by RLS WITH CHECK
        await expect(
          tx.service.create({
            data: {
              organizationId: FIXTURE.orgB,
              name: "Injected Service",
              basePriceInPaise: 10000,
              baseDurationMinutes: 15,
            },
          }),
        ).rejects.toThrow();
      },
      runtimePrisma,
    );

    // Confirm Org B service stayed untouched
    const orgBService = await withTenantDb(
      FIXTURE.orgB,
      (tx) => tx.service.findUniqueOrThrow({ where: { id: FIXTURE.serviceB } }),
      runtimePrisma,
    );
    expect(orgBService.name).toBe("Org B Haircut");
  });

  it("6. Branch A1 cannot access or mutate Branch A2 records when branch isolation is active", async () => {
    await withBranchDb(
      FIXTURE.orgA,
      FIXTURE.branchA1,
      async (tx) => {
        const tokens = await tx.token.findMany();
        const customers = await tx.customer.findMany();
        const branchA2Token = await tx.token.findUnique({
          where: { id: FIXTURE.tokenA2 },
        });

        expect(tokens.map((t) => t.id)).toEqual([FIXTURE.tokenA1]);
        expect(customers.map((c) => c.id)).toEqual([FIXTURE.customerA1]);
        expect(branchA2Token).toBeNull();

        const updateOtherBranch = await tx.token.updateMany({
          where: { id: FIXTURE.tokenA2 },
          data: { status: "CANCELLED" },
        });
        expect(updateOtherBranch.count).toBe(0);
      },
      runtimePrisma,
    );
  });

  it("7. Missing tenant context denies tenant-scoped reads and writes", async () => {
    const tokensWithoutContext = await runtimePrisma.token.findMany();
    expect(tokensWithoutContext).toEqual([]);

    await expect(
      runtimePrisma.service.create({
        data: {
          organizationId: FIXTURE.orgA,
          name: "Unauthorized Direct Insert",
          basePriceInPaise: 10000,
          baseDurationMinutes: 15,
        },
      }),
    ).rejects.toThrow();
  });

  it("8 & 9. Transaction rollback & pooled connections never leak tenant context", async () => {
    // 1. Run failing transaction inside Org A context on single-connection pool
    await expect(
      withTenantDb(
        FIXTURE.orgA,
        async (tx) => {
          await tx.service.create({
            data: {
              organizationId: FIXTURE.orgA,
              name: "Rolled Back Service",
              basePriceInPaise: 5000,
              baseDurationMinutes: 10,
            },
          });
          throw new Error("FORCE_ROLLBACK");
        },
        runtimePrisma,
      ),
    ).rejects.toThrow("FORCE_ROLLBACK");

    // 2. Same single pooled connection outside withTenantDb must have zero residual context
    const residual = await runtimePrisma.$queryRaw<
      Array<{ org: string | null; branch: string | null }>
    >`
      SELECT
        NULLIF(current_setting('app.current_organization_id', true), '') AS org,
        NULLIF(current_setting('app.current_branch_id', true), '') AS branch
    `;
    expect(residual[0]).toEqual({ org: null, branch: null });
    expect(await runtimePrisma.token.findMany()).toEqual([]);

    // 3. Rolled-back service must not exist
    const servicesAfterRollback = await withTenantDb(
      FIXTURE.orgA,
      (tx) => tx.service.findMany({ where: { name: "Rolled Back Service" } }),
      runtimePrisma,
    );
    expect(servicesAfterRollback).toHaveLength(0);

    // 4. Nested switching must throw TenantContextError
    await expect(
      withTenantDb(
        FIXTURE.orgA,
        () => withTenantDb(FIXTURE.orgB, async () => "blocked", runtimePrisma),
        runtimePrisma,
      ),
    ).rejects.toThrow(TenantContextError);
  });

  it("10. Composite foreign keys reject cross-tenant and cross-branch relational links", async () => {
    // Attempt cross-tenant BranchService (Branch A1 + Service B) -> rejected by composite FK
    await expect(
      adminTestPrisma.branchService.create({
        data: {
          organizationId: FIXTURE.orgA,
          branchId: FIXTURE.branchA1,
          serviceId: FIXTURE.serviceB,
        },
      }),
    ).rejects.toThrow();

    // Attempt cross-branch Token (Branch A1 + Customer A2 from Branch A2) -> rejected by composite FK
    await expect(
      adminTestPrisma.token.create({
        data: {
          publicId: "cross_branch_fail_tok",
          organizationId: FIXTURE.orgA,
          branchId: FIXTURE.branchA1,
          customerId: FIXTURE.customerA2,
          businessDate: BIZ_DATE,
          sequenceNumber: 99,
          tokenNumber: "A099",
          customerNameSnapshot: "Bad",
          customerMobileSnapshot: "9999999999",
          totalPriceInPaise: 1000,
          totalDurationMinutes: 10,
        },
      }),
    ).rejects.toThrow();

    // Attempt cross-tenant TokenService (Token A1 + Service B) -> rejected by composite FK
    await expect(
      adminTestPrisma.tokenService.create({
        data: {
          organizationId: FIXTURE.orgA,
          tokenId: FIXTURE.tokenA1,
          serviceId: FIXTURE.serviceB,
          serviceNameSnapshot: "Cross Org",
          priceInPaiseSnapshot: 1000,
          durationMinutesSnapshot: 10,
        },
      }),
    ).rejects.toThrow();
  });

  it("11. Concurrent Promise.all transactions & system-to-tenant nesting guard enforce isolation", async () => {
    const [tokensA, tokensB, allTokens] = await Promise.all([
      withTenantDb(FIXTURE.orgA, (tx) => tx.token.findMany(), runtimePrisma),
      withTenantDb(FIXTURE.orgB, (tx) => tx.token.findMany(), runtimePrisma),
      withSystemDb((tx) => tx.token.findMany(), runtimePrisma),
    ]);

    expect(tokensA.every((t) => t.organizationId === FIXTURE.orgA)).toBe(true);
    expect(tokensA).toHaveLength(2);
    expect(tokensB.every((t) => t.organizationId === FIXTURE.orgB)).toBe(true);
    expect(tokensB).toHaveLength(1);
    expect(allTokens).toHaveLength(3);

    await expect(
      withSystemDb(
        () => withTenantDb(FIXTURE.orgA, async () => "blocked", runtimePrisma),
        runtimePrisma,
      ),
    ).rejects.toThrow(TenantContextError);
  });
});
