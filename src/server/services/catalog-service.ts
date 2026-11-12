import { NotFoundError } from "@/lib/errors";
import type { AuthorizedTenantContext } from "@/server/auth";
import {
  branchCatalogCache,
  type EffectiveBranchServiceItem,
} from "@/server/cache/branch-catalog-cache";
import { withBranchDb, withTenantDb, type DbClient } from "@/server/db";
import type {
  CreateServiceInput,
  UpdateServiceInput,
  UpsertBranchServiceInput,
} from "@/features/services/schemas";

export interface CatalogMutationMeta {
  ipAddressHash?: string;
  userAgent?: string;
  client?: DbClient;
}

export async function listServicesWithBranchMatrix(
  ctx: AuthorizedTenantContext,
  client?: DbClient,
) {
  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const branchWhere = ctx.allBranches
        ? { organizationId: ctx.organizationId }
        : {
            organizationId: ctx.organizationId,
            id: { in: [...ctx.allowedBranchIds] },
          };

      const [services, branches, branchServices] = await Promise.all([
        tx.service.findMany({
          where: { organizationId: ctx.organizationId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            description: true,
            basePriceInPaise: true,
            baseDurationMinutes: true,
            isActive: true,
            sortOrder: true,
          },
        }),
        tx.branch.findMany({
          where: branchWhere,
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, slug: true, isActive: true },
        }),
        tx.branchService.findMany({
          where: { organizationId: ctx.organizationId },
          select: {
            id: true,
            branchId: true,
            serviceId: true,
            isAvailable: true,
            priceOverrideInPaise: true,
            durationOverrideMinutes: true,
            sortOrder: true,
          },
        }),
      ]);

      const overrideByPair = new Map<string, (typeof branchServices)[number]>();
      for (const bs of branchServices) {
        overrideByPair.set(`${bs.serviceId}:${bs.branchId}`, bs);
      }

      return {
        branches,
        services: services.map((svc) => ({
          ...svc,
          branchOverrides: branches.map((branch) => {
            const override = overrideByPair.get(`${svc.id}:${branch.id}`);
            return {
              branchId: branch.id,
              isAvailable: override?.isAvailable ?? false,
              priceOverrideInPaise: override?.priceOverrideInPaise ?? null,
              durationOverrideMinutes: override?.durationOverrideMinutes ?? null,
              sortOrder: override?.sortOrder ?? svc.sortOrder,
            };
          }),
        })),
      };
    },
    client,
  );
}

export async function createOrganizationService(
  ctx: AuthorizedTenantContext,
  input: CreateServiceInput,
  meta: CatalogMutationMeta = {},
) {
  const service = await withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const created = await tx.service.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name.trim(),
          description: input.description ? input.description.trim() : null,
          basePriceInPaise: input.basePriceInPaise,
          baseDurationMinutes: input.baseDurationMinutes,
          sortOrder: input.sortOrder,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          description: true,
          basePriceInPaise: true,
          baseDurationMinutes: true,
          isActive: true,
          sortOrder: true,
        },
      });

      const branches = await tx.branch.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true },
      });

      if (branches.length > 0) {
        await tx.branchService.createMany({
          data: branches.map((branch) => ({
            organizationId: ctx.organizationId,
            branchId: branch.id,
            serviceId: created.id,
            isAvailable: true,
            sortOrder: created.sortOrder,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "SERVICE_CREATED",
          entityType: "Service",
          entityId: created.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: {
            name: created.name,
            basePriceInPaise: created.basePriceInPaise,
            baseDurationMinutes: created.baseDurationMinutes,
          },
        },
      });

      return created;
    },
    meta.client,
  );

  branchCatalogCache.invalidateOrganization(ctx.organizationId);
  return service;
}

export async function updateOrganizationService(
  ctx: AuthorizedTenantContext,
  serviceId: string,
  input: UpdateServiceInput,
  meta: CatalogMutationMeta = {},
) {
  const updated = await withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const existing = await tx.service.findFirst({
        where: { id: serviceId, organizationId: ctx.organizationId },
        select: { id: true },
      });

      if (!existing) {
        throw new NotFoundError("Service was not found.");
      }

      const saved = await tx.service.update({
        where: { id: serviceId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description ? input.description.trim() : null }
            : {}),
          ...(input.basePriceInPaise !== undefined
            ? { basePriceInPaise: input.basePriceInPaise }
            : {}),
          ...(input.baseDurationMinutes !== undefined
            ? { baseDurationMinutes: input.baseDurationMinutes }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
        select: {
          id: true,
          name: true,
          description: true,
          basePriceInPaise: true,
          baseDurationMinutes: true,
          isActive: true,
          sortOrder: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: input.isActive === false ? "SERVICE_DEACTIVATED" : "SERVICE_UPDATED",
          entityType: "Service",
          entityId: serviceId,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: { updatedFields: Object.keys(input) },
        },
      });

      return saved;
    },
    meta.client,
  );

  branchCatalogCache.invalidateOrganization(ctx.organizationId);
  return updated;
}

export async function upsertBranchServiceOverride(
  ctx: AuthorizedTenantContext,
  branchId: string,
  serviceId: string,
  input: UpsertBranchServiceInput,
  meta: CatalogMutationMeta = {},
) {
  const saved = await withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => {
      const [branch, service] = await Promise.all([
        tx.branch.findFirst({
          where: { id: branchId, organizationId: ctx.organizationId },
          select: { id: true },
        }),
        tx.service.findFirst({
          where: { id: serviceId, organizationId: ctx.organizationId },
          select: { id: true, sortOrder: true },
        }),
      ]);

      if (!branch || !service) {
        throw new NotFoundError("Branch or service was not found.");
      }

      const branchService = await tx.branchService.upsert({
        where: {
          branchId_serviceId: { branchId, serviceId },
        },
        update: {
          isAvailable: input.isAvailable,
          ...(input.priceOverrideInPaise !== undefined
            ? { priceOverrideInPaise: input.priceOverrideInPaise }
            : {}),
          ...(input.durationOverrideMinutes !== undefined
            ? { durationOverrideMinutes: input.durationOverrideMinutes }
            : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
        create: {
          organizationId: ctx.organizationId,
          branchId,
          serviceId,
          isAvailable: input.isAvailable,
          priceOverrideInPaise: input.priceOverrideInPaise ?? null,
          durationOverrideMinutes: input.durationOverrideMinutes ?? null,
          sortOrder: input.sortOrder ?? service.sortOrder,
        },
        select: {
          id: true,
          branchId: true,
          serviceId: true,
          isAvailable: true,
          priceOverrideInPaise: true,
          durationOverrideMinutes: true,
          sortOrder: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          branchId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "BRANCH_SERVICE_UPDATED",
          entityType: "BranchService",
          entityId: branchService.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: {
            serviceId,
            isAvailable: branchService.isAvailable,
            priceOverrideInPaise: branchService.priceOverrideInPaise,
            durationOverrideMinutes: branchService.durationOverrideMinutes,
          },
        },
      });

      return branchService;
    },
    meta.client,
  );

  branchCatalogCache.invalidateBranch(ctx.organizationId, branchId);
  return saved;
}

export async function getCachedAvailableBranchServices(
  organizationId: string,
  branchId: string,
  client?: DbClient,
): Promise<EffectiveBranchServiceItem[]> {
  const cached = branchCatalogCache.get(organizationId, branchId);
  if (cached) {
    return cached;
  }

  const fresh = await withBranchDb(
    organizationId,
    branchId,
    async (tx) => {
      const rows = await tx.branchService.findMany({
        where: {
          organizationId,
          branchId,
          isAvailable: true,
          service: { isActive: true },
        },
        orderBy: [{ sortOrder: "asc" }, { service: { sortOrder: "asc" } }],
        select: {
          serviceId: true,
          priceOverrideInPaise: true,
          durationOverrideMinutes: true,
          sortOrder: true,
          service: {
            select: {
              name: true,
              description: true,
              basePriceInPaise: true,
              baseDurationMinutes: true,
            },
          },
        },
      });

      return rows.map((row) => ({
        serviceId: row.serviceId,
        name: row.service.name,
        description: row.service.description,
        priceInPaise: row.priceOverrideInPaise ?? row.service.basePriceInPaise,
        durationMinutes: row.durationOverrideMinutes ?? row.service.baseDurationMinutes,
        sortOrder: row.sortOrder,
      }));
    },
    client,
  );

  branchCatalogCache.set(organizationId, branchId, fresh);
  return fresh;
}
