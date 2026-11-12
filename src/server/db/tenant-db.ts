import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { internalPrisma } from "./client";

const uuidSchema = z.string().uuid();

export interface TenantDbContext {
  organizationId: string;
  branchId?: string;
}

export type TenantTransactionClient = Prisma.TransactionClient;

type DbTransactionScope =
  { mode: "tenant"; context: TenantDbContext } | { mode: "system" };

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

const dbScopeStorage = new AsyncLocalStorage<DbTransactionScope>();

export function getActiveTenantContext(): TenantDbContext | undefined {
  const scope = dbScopeStorage.getStore();
  return scope?.mode === "tenant" ? scope.context : undefined;
}

export function getActiveDbScope(): DbTransactionScope | undefined {
  return dbScopeStorage.getStore();
}

export function runInSystemDbScope<T>(fn: () => Promise<T>): Promise<T> {
  return dbScopeStorage.run({ mode: "system" }, fn);
}

function normalizeContext(context: string | TenantDbContext): TenantDbContext {
  const raw = typeof context === "string" ? { organizationId: context } : context;
  const orgParsed = uuidSchema.safeParse(raw.organizationId);
  if (!orgParsed.success) {
    throw new TenantContextError("Invalid organizationId for tenant DB context");
  }

  if (raw.branchId !== undefined) {
    const branchParsed = uuidSchema.safeParse(raw.branchId);
    if (!branchParsed.success) {
      throw new TenantContextError("Invalid branchId for tenant DB context");
    }
    return { organizationId: orgParsed.data, branchId: branchParsed.data };
  }

  return { organizationId: orgParsed.data };
}

/**
 * Executes `fn` inside an interactive PostgreSQL transaction with transaction-local
 * RLS tenant context (`SET LOCAL` equivalent via `set_config(..., true)`).
 * Rejects nested calls to prevent accidental context switching or pool deadlocks.
 */
export async function withTenantDb<T>(
  context: string | TenantDbContext,
  fn: (tx: TenantTransactionClient) => Promise<T>,
  client: PrismaClient = internalPrisma,
): Promise<T> {
  const activeScope = dbScopeStorage.getStore();
  if (activeScope?.mode === "tenant") {
    throw new TenantContextError(
      `Nested tenant DB context is forbidden (active=${activeScope.context.organizationId})`,
    );
  }
  if (activeScope?.mode === "system") {
    throw new TenantContextError(
      "withTenantDb cannot be invoked inside an active system DB transaction",
    );
  }

  const normalized = normalizeContext(context);

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${normalized.organizationId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_branch_id', ${normalized.branchId ?? ""}, true)`;

    return dbScopeStorage.run({ mode: "tenant", context: normalized }, () => fn(tx));
  });
}

/**
 * Enforces both organization and strict branch-level RLS isolation inside the transaction.
 */
export async function withBranchDb<T>(
  organizationId: string,
  branchId: string,
  fn: (tx: TenantTransactionClient) => Promise<T>,
  client: PrismaClient = internalPrisma,
): Promise<T> {
  return withTenantDb({ organizationId, branchId }, fn, client);
}
