import type { Prisma, PrismaClient } from "@prisma/client";
import { internalPrisma } from "./client";
import { TenantContextError, getActiveDbScope, runInSystemDbScope } from "./tenant-db";

/**
 * Restricted transaction helper for non-tenant system flows (auth login lookup,
 * public slug resolution, outbox worker claiming, and Platform Admin diagnostics).
 * Never callable inside an active `withTenantDb` or nested `withSystemDb` scope.
 */
export async function withSystemDb<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  client: PrismaClient = internalPrisma,
): Promise<T> {
  const activeScope = getActiveDbScope();
  if (activeScope?.mode === "tenant") {
    throw new TenantContextError(
      "withSystemDb cannot be invoked inside an active tenant DB transaction",
    );
  }
  if (activeScope?.mode === "system") {
    throw new TenantContextError("Nested system DB context is forbidden");
  }

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_organization_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.current_branch_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return runInSystemDbScope(() => fn(tx));
  });
}
