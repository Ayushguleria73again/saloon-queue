import type { Prisma } from "@prisma/client";
import type {
  AdminJobItemDto,
  AdminJobListResponseDto,
  AdminTenantItemDto,
  AdminTenantListResponseDto,
  PlatformHealthDetailsDto,
  PlatformOverviewDto,
} from "@/features/admin/types";
import type {
  AdminJobQueryInput,
  AdminTenantQueryInput,
  UpdateTenantStatusInput,
} from "@/features/admin/schemas";
import { NotFoundError } from "@/lib/errors";
import type { PlatformAdminContext } from "@/server/auth";
import { withSystemDb, type DbClient } from "@/server/db";
import { nudgeOutboxWorker } from "@/server/jobs/runner";

export interface PlatformMutationMeta {
  ipAddressHash?: string;
  userAgent?: string;
  client?: DbClient;
}

/**
 * Returns platform-wide KPIs: tenant counts, active branches, today's tokens, and outbox job health.
 * Strictly non-PII (`IT-ADM-02`).
 */
export async function getPlatformOverview(
  _adminCtx: PlatformAdminContext,
  client?: DbClient,
): Promise<PlatformOverviewDto> {
  return withSystemDb(async (tx) => {
    const todayIso = new Date().toISOString().slice(0, 10);

    const [
      orgStats,
      branchStats,
      tokenStats,
      jobStats,
    ] = await Promise.all([
      tx.$queryRaw<
        Array<{
          total: bigint;
          active: bigint;
          pending: bigint;
          suspended: bigint;
          deactivated: bigint;
        }>
      >`
        SELECT
          COUNT(*)::bigint AS "total",
          COUNT(*) FILTER (WHERE "status" = 'ACTIVE')::bigint AS "active",
          COUNT(*) FILTER (WHERE "status" = 'PENDING')::bigint AS "pending",
          COUNT(*) FILTER (WHERE "status" = 'SUSPENDED')::bigint AS "suspended",
          COUNT(*) FILTER (WHERE "status" = 'DEACTIVATED')::bigint AS "deactivated"
        FROM "organizations"
      `,
      tx.$queryRaw<
        Array<{
          total: bigint;
          active: bigint;
        }>
      >`
        SELECT
          COUNT(*)::bigint AS "total",
          COUNT(*) FILTER (WHERE "is_active" = true)::bigint AS "active"
        FROM "branches"
      `,
      tx.$queryRaw<
        Array<{
          today_total: bigint;
          today_completed: bigint;
          today_serving_or_waiting: bigint;
        }>
      >`
        SELECT
          COUNT(*)::bigint AS "today_total",
          COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::bigint AS "today_completed",
          COUNT(*) FILTER (WHERE "status" IN ('WAITING', 'CALLED', 'IN_SERVICE'))::bigint AS "today_serving_or_waiting"
        FROM "tokens"
        WHERE "business_date" = ${todayIso}::date
      `,
      tx.$queryRaw<
        Array<{
          pending: bigint;
          processing: bigint;
          retrying: bigint;
          dead_letter: bigint;
        }>
      >`
        SELECT
          COUNT(*) FILTER (WHERE "status" = 'PENDING')::bigint AS "pending",
          COUNT(*) FILTER (WHERE "status" = 'PROCESSING')::bigint AS "processing",
          COUNT(*) FILTER (WHERE "status" = 'RETRYING')::bigint AS "retrying",
          COUNT(*) FILTER (WHERE "status" = 'DEAD_LETTER')::bigint AS "dead_letter"
        FROM "notification_events"
      `,
    ]);

    const orgRow = orgStats[0];
    const branchRow = branchStats[0];
    const tokenRow = tokenStats[0];
    const jobRow = jobStats[0];

    return {
      organizations: {
        total: Number(orgRow?.total ?? 0n),
        active: Number(orgRow?.active ?? 0n),
        pending: Number(orgRow?.pending ?? 0n),
        suspended: Number(orgRow?.suspended ?? 0n),
        deactivated: Number(orgRow?.deactivated ?? 0n),
      },
      branches: {
        total: Number(branchRow?.total ?? 0n),
        active: Number(branchRow?.active ?? 0n),
      },
      tokens: {
        todayTotal: Number(tokenRow?.today_total ?? 0n),
        todayCompleted: Number(tokenRow?.today_completed ?? 0n),
        todayServingOrWaiting: Number(tokenRow?.today_serving_or_waiting ?? 0n),
      },
      jobs: {
        pending: Number(jobRow?.pending ?? 0n),
        processing: Number(jobRow?.processing ?? 0n),
        retrying: Number(jobRow?.retrying ?? 0n),
        deadLetter: Number(jobRow?.dead_letter ?? 0n),
      },
    };
  }, client);
}

/**
 * Returns paginated organizations directory with branch, member, and token counts.
 * Strictly non-PII (`IT-ADM-02`).
 */
export async function listTenants(
  _adminCtx: PlatformAdminContext,
  query: AdminTenantQueryInput,
  client?: DbClient,
): Promise<AdminTenantListResponseDto> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  return withSystemDb(async (tx) => {
    const where: Prisma.OrganizationWhereInput = {};

    if (query.status && query.status !== "ALL") {
      where.status = query.status;
    }

    if (query.q && query.q.trim().length > 0) {
      const term = query.q.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { slug: { contains: term, mode: "insensitive" } },
      ];
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [totalCount, rows] = await Promise.all([
      tx.organization.count({ where }),
      tx.organization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              branches: true,
              members: true,
            },
          },
          members: {
            where: {
              staffRole: { slug: "OWNER" },
            },
            take: 1,
            select: {
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ]);

    // Query 30-day token volume in a single grouped pass
    const orgIds = rows.map((r) => r.id);
    const tokenCountsMap = new Map<string, number>();

    if (orgIds.length > 0) {
      const tokenCounts = await tx.token.groupBy({
        by: ["organizationId"],
        where: {
          organizationId: { in: orgIds },
          createdAt: { gte: thirtyDaysAgo },
        },
        _count: { _all: true },
      });
      for (const tc of tokenCounts) {
        tokenCountsMap.set(tc.organizationId, tc._count._all);
      }
    }

    const items: AdminTenantItemDto[] = rows.map((org) => {
      const owner = org.members[0]?.user ?? null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
        branchCount: org._count.branches,
        memberCount: org._count.members,
        thirtyDayTokenCount: tokenCountsMap.get(org.id) ?? 0,
        ownerName: owner?.name ?? null,
        ownerEmail: owner?.email ?? null,
      };
    });

    return {
      items,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1,
    };
  }, client);
}

/**
 * Updates an organization's status (e.g. ACTIVE -> SUSPENDED), records an audit log,
 * and increments sessionVersion for all organization users to immediately invalidate
 * active dashboard sessions (`IT-ADM-01`).
 */
export async function updateTenantStatus(
  adminCtx: PlatformAdminContext,
  organizationId: string,
  input: UpdateTenantStatusInput,
  meta: PlatformMutationMeta = {},
): Promise<AdminTenantItemDto> {
  return withSystemDb(async (tx) => {
    const existing = await tx.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            branches: true,
            members: true,
          },
        },
        members: {
          where: { staffRole: { slug: "OWNER" } },
          take: 1,
          select: {
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundError("Organization was not found.");
    }

    const previousStatus = existing.status;

    const updated = await tx.organization.update({
      where: { id: organizationId },
      data: { status: input.status },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Record immutable audit log
    await tx.auditLog.create({
      data: {
        organizationId,
        actorType: "PLATFORM_ADMIN",
        actorId: adminCtx.userId,
        action: "TENANT_STATUS_CHANGED",
        entityType: "Organization",
        entityId: organizationId,
        metadata: {
          previousStatus,
          newStatus: input.status,
          reason: input.reason,
        },
        ipAddressHash: meta.ipAddressHash ?? null,
        userAgent: meta.userAgent?.slice(0, 256) ?? null,
      },
    });

    // If tenant suspended or deactivated, immediately invalidate active sessions
    if (input.status === "SUSPENDED" || input.status === "DEACTIVATED") {
      await tx.user.updateMany({
        where: {
          memberships: { some: { organizationId } },
        },
        data: {
          sessionVersion: { increment: 1 },
        },
      });
    }

    const owner = existing.members[0]?.user ?? null;

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      branchCount: existing._count.branches,
      memberCount: existing._count.members,
      thirtyDayTokenCount: 0,
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
    };
  }, meta.client);
}

/**
 * Returns paginated background notification outbox events with sanitized non-PII metadata.
 * Customer names, phone numbers, and notes are never returned (`IT-ADM-02`).
 */
export async function listPlatformJobs(
  _adminCtx: PlatformAdminContext,
  query: AdminJobQueryInput,
  client?: DbClient,
): Promise<AdminJobListResponseDto> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  return withSystemDb(async (tx) => {
    const where: Prisma.NotificationEventWhereInput = {};

    if (query.status && query.status !== "ALL") {
      where.status = query.status;
    }

    if (query.q && query.q.trim().length > 0) {
      const term = query.q.trim();
      where.OR = [
        { eventType: { contains: term, mode: "insensitive" } },
        { lastError: { contains: term, mode: "insensitive" } },
        { organization: { name: { contains: term, mode: "insensitive" } } },
      ];
    }

    const [totalCount, rows] = await Promise.all([
      tx.notificationEvent.count({ where }),
      tx.notificationEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          organizationId: true,
          branchId: true,
          eventType: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          nextAttemptAt: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
          organization: { select: { name: true } },
          branch: { select: { name: true } },
        },
      }),
    ]);

    const items: AdminJobItemDto[] = rows.map((evt) => ({
      id: evt.id,
      organizationId: evt.organizationId,
      organizationName: evt.organization.name,
      branchId: evt.branchId,
      branchName: evt.branch?.name ?? null,
      eventType: evt.eventType,
      status: evt.status,
      attemptCount: evt.attemptCount,
      maxAttempts: evt.maxAttempts,
      nextAttemptAt: evt.nextAttemptAt ? evt.nextAttemptAt.toISOString() : null,
      lastError: evt.lastError,
      createdAt: evt.createdAt.toISOString(),
      updatedAt: evt.updatedAt.toISOString(),
    }));

    return {
      items,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1,
    };
  }, client);
}

/**
 * Resets a dead-lettered or failed event to PENDING with nextAttemptAt = now,
 * and triggers immediate worker pickup.
 */
export async function retryPlatformJob(
  adminCtx: PlatformAdminContext,
  eventId: string,
  meta: PlatformMutationMeta = {},
): Promise<{ success: boolean; eventId: string }> {
  return withSystemDb(async (tx) => {
    const existing = await tx.notificationEvent.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true, status: true },
    });

    if (!existing) {
      throw new NotFoundError("Notification event was not found.");
    }

    await tx.notificationEvent.update({
      where: { id: eventId },
      data: {
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        lockedUntil: null,
        lockedBy: null,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: existing.organizationId,
        actorType: "PLATFORM_ADMIN",
        actorId: adminCtx.userId,
        action: "JOB_RETRIED",
        entityType: "NotificationEvent",
        entityId: eventId,
        metadata: {
          previousStatus: existing.status,
        },
        ipAddressHash: meta.ipAddressHash ?? null,
        userAgent: meta.userAgent?.slice(0, 256) ?? null,
      },
    });

    nudgeOutboxWorker();

    return { success: true, eventId };
  }, meta.client);
}

/**
 * Returns platform system health details: DB connection latency and VAPID presence.
 */
export async function getPlatformHealthDetails(
  _adminCtx: PlatformAdminContext,
  client?: DbClient,
): Promise<PlatformHealthDetailsDto> {
  const start = Date.now();
  let dbOk = false;

  try {
    await withSystemDb(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
    }, client);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const latencyMs = Date.now() - start;
  const vapidConfigured = Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );

  return {
    status: dbOk ? "healthy" : "degraded",
    database: {
      connected: dbOk,
      latencyMs,
    },
    vapidConfigured,
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

