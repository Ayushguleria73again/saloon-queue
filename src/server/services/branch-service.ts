import { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { AuthorizedTenantContext } from "@/server/auth";
import { branchCatalogCache } from "@/server/cache/branch-catalog-cache";
import { withBranchDb, withTenantDb, type DbClient } from "@/server/db";
import { nudgeOutboxWorker } from "@/server/jobs/runner";
import { getRealtimeHub } from "@/server/realtime";
import { generateOpaqueToken } from "@/server/security/tokens";
import type { CreateBranchInput, UpdateBranchInput } from "@/features/branches/schemas";

export interface BranchMutationMeta {
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
}

const BRANCH_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  phone: true,
  address: true,
  city: true,
  timezone: true,
  qrToken: true,
  isActive: true,
  createdAt: true,
  businessHours: {
    orderBy: { dayOfWeek: "asc" as const },
    select: {
      dayOfWeek: true,
      isOpen: true,
      openTime: true,
      closeTime: true,
      breakStartTime: true,
      breakEndTime: true,
    },
  },
  salonSettings: {
    take: 1,
    select: {
      tokenPrefix: true,
      activeStationsCount: true,
      allowDuplicateActiveTokens: true,
      allowCustomerCancel: true,
      enforceBusinessHours: true,
      isAcceptingTokens: true,
      queuePausedReason: true,
      requireValidQrToken: true,
      estimatedBufferMinutes: true,
    },
  },
};

export async function listAccessibleBranches(
  ctx: AuthorizedTenantContext,
  client?: DbClient,
) {
  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const where = ctx.allBranches
        ? { organizationId: ctx.organizationId }
        : {
            organizationId: ctx.organizationId,
            id: { in: [...ctx.allowedBranchIds] },
          };

      const branches = await tx.branch.findMany({
        where,
        orderBy: { createdAt: "asc" },
        select: BRANCH_SELECT,
      });

      return branches.map((branch) => ({
        ...branch,
        settings: branch.salonSettings[0] ?? null,
        salonSettings: undefined,
      }));
    },
    client,
  );
}

export async function createBranch(
  ctx: AuthorizedTenantContext,
  input: CreateBranchInput,
  meta: BranchMutationMeta = {},
) {
  const normalizedSlug = input.slug.trim().toLowerCase();

  try {
    return await withTenantDb(
      ctx.organizationId,
      async (tx) => {
        const existing = await tx.branch.findUnique({
          where: {
            organizationId_slug: {
              organizationId: ctx.organizationId,
              slug: normalizedSlug,
            },
          },
          select: { id: true },
        });

        if (existing) {
          throw new ConflictError(
            "SLUG_TAKEN",
            "A branch with this URL slug already exists in your organization.",
          );
        }

        const orgDefaultSettings = await tx.salonSettings.findFirst({
          where: { organizationId: ctx.organizationId, branchId: null },
        });

        const branch = await tx.branch.create({
          data: {
            organizationId: ctx.organizationId,
            name: input.name.trim(),
            slug: normalizedSlug,
            phone: input.phone ? input.phone.trim() : null,
            address: input.address ? input.address.trim() : null,
            city: input.city ? input.city.trim() : null,
            timezone: input.timezone,
            qrToken: generateOpaqueToken(16),
            isActive: true,
          },
          select: { id: true, slug: true, name: true },
        });

        await tx.businessHours.createMany({
          data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            organizationId: ctx.organizationId,
            branchId: branch.id,
            dayOfWeek,
            isOpen: true,
            openTime: "09:30",
            closeTime: "21:30",
          })),
        });

        await tx.salonSettings.create({
          data: {
            organizationId: ctx.organizationId,
            branchId: branch.id,
            tokenPrefix: orgDefaultSettings?.tokenPrefix ?? "A",
            activeStationsCount: orgDefaultSettings?.activeStationsCount ?? 1,
            allowDuplicateActiveTokens:
              orgDefaultSettings?.allowDuplicateActiveTokens ?? false,
            allowCustomerCancel: orgDefaultSettings?.allowCustomerCancel ?? true,
            enforceBusinessHours: orgDefaultSettings?.enforceBusinessHours ?? true,
            isAcceptingTokens: orgDefaultSettings?.isAcceptingTokens ?? true,
            requireValidQrToken: orgDefaultSettings?.requireValidQrToken ?? false,
            dayResetTime: orgDefaultSettings?.dayResetTime ?? "00:00",
            estimatedBufferMinutes: orgDefaultSettings?.estimatedBufferMinutes ?? 0,
            customerPushThresholds: orgDefaultSettings?.customerPushThresholds ?? [3, 1],
            notifyDelayThresholdMinutes:
              orgDefaultSettings?.notifyDelayThresholdMinutes ?? 15,
            longQueueAlertThreshold: orgDefaultSettings?.longQueueAlertThreshold ?? 10,
          },
        });

        const activeServices = await tx.service.findMany({
          where: { organizationId: ctx.organizationId, isActive: true },
          select: { id: true, sortOrder: true },
        });

        if (activeServices.length > 0) {
          await tx.branchService.createMany({
            data: activeServices.map((svc) => ({
              organizationId: ctx.organizationId,
              branchId: branch.id,
              serviceId: svc.id,
              isAvailable: true,
              sortOrder: svc.sortOrder,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            organizationId: ctx.organizationId,
            branchId: branch.id,
            actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
            actorId: ctx.userId,
            action: "BRANCH_CREATED",
            entityType: "Branch",
            entityId: branch.id,
            ipAddressHash: meta.ipAddressHash ?? null,
            userAgent: meta.userAgent?.slice(0, 256) ?? null,
            metadata: { slug: branch.slug, name: branch.name },
          },
        });

        const fullBranch = await tx.branch.findUniqueOrThrow({
          where: { id: branch.id },
          select: BRANCH_SELECT,
        });

        return {
          ...fullBranch,
          settings: fullBranch.salonSettings[0] ?? null,
          salonSettings: undefined,
        };
      },
      meta.client,
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError(
        "SLUG_TAKEN",
        "A branch with this URL slug already exists in your organization.",
      );
    }
    throw error;
  }
}

export async function updateBranch(
  ctx: AuthorizedTenantContext,
  branchId: string,
  input: UpdateBranchInput,
  meta: BranchMutationMeta = {},
) {
  const now = meta.now ?? new Date();
  let queuedDelayNotifications = false;

  const result = await withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { id: branchId, organizationId: ctx.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          organization: { select: { slug: true } },
        },
      });

      if (!existing) {
        throw new NotFoundError("Branch was not found.");
      }

      if (
        input.name !== undefined ||
        input.phone !== undefined ||
        input.address !== undefined ||
        input.city !== undefined ||
        input.timezone !== undefined ||
        input.isActive !== undefined
      ) {
        await tx.branch.update({
          where: { id: branchId },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.phone !== undefined
              ? { phone: input.phone ? input.phone.trim() : null }
              : {}),
            ...(input.address !== undefined
              ? { address: input.address ? input.address.trim() : null }
              : {}),
            ...(input.city !== undefined
              ? { city: input.city ? input.city.trim() : null }
              : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      }

      if (input.businessHours && input.businessHours.length > 0) {
        for (const hour of input.businessHours) {
          await tx.businessHours.upsert({
            where: {
              branchId_dayOfWeek: { branchId, dayOfWeek: hour.dayOfWeek },
            },
            update: {
              isOpen: hour.isOpen,
              openTime: hour.openTime,
              closeTime: hour.closeTime,
              breakStartTime: hour.breakStartTime ?? null,
              breakEndTime: hour.breakEndTime ?? null,
            },
            create: {
              organizationId: ctx.organizationId,
              branchId,
              dayOfWeek: hour.dayOfWeek,
              isOpen: hour.isOpen,
              openTime: hour.openTime,
              closeTime: hour.closeTime,
              breakStartTime: hour.breakStartTime ?? null,
              breakEndTime: hour.breakEndTime ?? null,
            },
          });
        }
      }

      if (input.settings) {
        await tx.salonSettings.upsert({
          where: {
            organizationId_branchId: {
              organizationId: ctx.organizationId,
              branchId,
            },
          },
          update: {
            ...input.settings,
          },
          create: {
            organizationId: ctx.organizationId,
            branchId,
            ...input.settings,
          },
        });

        if (input.settings.isAcceptingTokens === false) {
          const subscribedWaiting = await tx.token.findMany({
            where: {
              organizationId: ctx.organizationId,
              branchId,
              status: "WAITING",
              pushSubscriptions: {
                some: {
                  subscriberType: "CUSTOMER",
                  isActive: true,
                },
              },
            },
            select: {
              id: true,
              publicId: true,
              tokenNumber: true,
            },
          });

          if (subscribedWaiting.length > 0) {
            const bucketHour = Math.floor(now.getTime() / 3_600_000);
            const reason =
              typeof input.settings.queuePausedReason === "string"
                ? input.settings.queuePausedReason
                : undefined;

            await tx.notificationEvent.createMany({
              data: subscribedWaiting.map((token) => ({
                organizationId: ctx.organizationId,
                branchId,
                tokenId: token.id,
                eventType: "QUEUE_DELAYED",
                idempotencyKey: `token:${token.id}:DELAYED:${bucketHour}`,
                status: "PENDING",
                payload: {
                  tokenId: token.id,
                  publicId: token.publicId,
                  tokenNumber: token.tokenNumber,
                  branchId,
                  branchName: existing.name,
                  ...(reason ? { reason } : {}),
                  targetUrl: `/salon/${existing.organization.slug}/${existing.slug}/token/${token.publicId}`,
                },
              })),
              skipDuplicates: true,
            });
            queuedDelayNotifications = true;
          }
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          branchId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "BRANCH_UPDATED",
          entityType: "Branch",
          entityId: branchId,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: {
            updatedFields: Object.keys(input),
          },
        },
      });

      const updated = await tx.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: BRANCH_SELECT,
      });

      branchCatalogCache.invalidateBranch(ctx.organizationId, branchId);

      return {
        ...updated,
        settings: updated.salonSettings[0] ?? null,
        salonSettings: undefined,
      };
    },
    meta.client,
  );

  if (queuedDelayNotifications) {
    nudgeOutboxWorker();
  }

  getRealtimeHub().publishQueueMutation({
    organizationId: ctx.organizationId,
    branchId,
    action: "BRANCH_SETTINGS_UPDATED",
    timestamp: new Date().toISOString(),
  });

  return result;
}
