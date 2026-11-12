export type { PrismaClient as DbClient } from "@prisma/client";
export { checkDatabaseHealth, type DatabaseHealthResult } from "./prisma";
export {
  TenantContextError,
  getActiveTenantContext,
  withBranchDb,
  withTenantDb,
  type TenantDbContext,
  type TenantTransactionClient,
} from "./tenant-db";
export { withSystemDb } from "./system-db";
