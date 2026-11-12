import { describe, expect, it, vi } from "vitest";
import {
  TenantContextError,
  getActiveTenantContext,
  withBranchDb,
  withTenantDb,
} from "@/server/db/tenant-db";
import { withSystemDb } from "@/server/db/system-db";

const ORG_A = "11111111-1111-4111-8111-111111111100";
const ORG_B = "22222222-2222-4222-8222-222222222200";
const BRANCH_A1 = "11111111-1111-4111-8111-111111111131";

function createMockPrisma() {
  const executedSql: string[] = [];
  const mockTx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executedSql.push(strings.join("?") + ` [${values.join(",")}]`);
      return 1;
    }),
  };

  const mockClient = {
    $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
      return cb(mockTx);
    }),
  };

  return { mockClient, mockTx, executedSql };
}

describe("withTenantDb / withBranchDb", () => {
  it("rejects invalid non-UUID organizationId or branchId", async () => {
    const { mockClient } = createMockPrisma();

    await expect(
      withTenantDb("not-a-uuid", async () => "ok", mockClient as never),
    ).rejects.toThrow(TenantContextError);

    await expect(
      withBranchDb(ORG_A, "bad-branch", async () => "ok", mockClient as never),
    ).rejects.toThrow(TenantContextError);
  });

  it("sets transaction-local org and branch config and clears ALS context afterward", async () => {
    const { mockClient, executedSql } = createMockPrisma();

    const result = await withBranchDb(
      ORG_A,
      BRANCH_A1,
      async () => {
        expect(getActiveTenantContext()).toEqual({
          organizationId: ORG_A,
          branchId: BRANCH_A1,
        });
        return "done";
      },
      mockClient as never,
    );

    expect(result).toBe("done");
    expect(getActiveTenantContext()).toBeUndefined();
    expect(executedSql.some((s) => s.includes(ORG_A))).toBe(true);
    expect(executedSql.some((s) => s.includes(BRANCH_A1))).toBe(true);
  });

  it("forbids nested withTenantDb context switching and clears context on error", async () => {
    const { mockClient } = createMockPrisma();

    await expect(
      withTenantDb(
        ORG_A,
        async () => {
          return withTenantDb(ORG_B, async () => "oops", mockClient as never);
        },
        mockClient as never,
      ),
    ).rejects.toThrow(TenantContextError);

    expect(getActiveTenantContext()).toBeUndefined();
  });

  it("forbids withSystemDb inside an active withTenantDb transaction", async () => {
    const { mockClient } = createMockPrisma();

    await expect(
      withTenantDb(
        ORG_A,
        async () => {
          return withSystemDb(async () => "oops", mockClient as never);
        },
        mockClient as never,
      ),
    ).rejects.toThrow(TenantContextError);
  });

  it("forbids withTenantDb and nested withSystemDb inside an active withSystemDb transaction", async () => {
    const { mockClient } = createMockPrisma();

    await expect(
      withSystemDb(
        async () => withTenantDb(ORG_A, async () => "oops", mockClient as never),
        mockClient as never,
      ),
    ).rejects.toThrow(TenantContextError);

    await expect(
      withSystemDb(
        async () => withSystemDb(async () => "oops", mockClient as never),
        mockClient as never,
      ),
    ).rejects.toThrow(TenantContextError);

    expect(getActiveTenantContext()).toBeUndefined();
  });

  it("isolates AsyncLocalStorage context across concurrent Promise.all scopes", async () => {
    const { mockClient } = createMockPrisma();

    const [ctxA, ctxB, ctxSys] = await Promise.all([
      withTenantDb(
        ORG_A,
        async () => {
          await new Promise((r) => setTimeout(r, 15));
          return getActiveTenantContext()?.organizationId;
        },
        mockClient as never,
      ),
      withTenantDb(
        ORG_B,
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          return getActiveTenantContext()?.organizationId;
        },
        mockClient as never,
      ),
      withSystemDb(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return getActiveTenantContext();
      }, mockClient as never),
    ]);

    expect(ctxA).toBe(ORG_A);
    expect(ctxB).toBe(ORG_B);
    expect(ctxSys).toBeUndefined();
    expect(getActiveTenantContext()).toBeUndefined();
  });
});
