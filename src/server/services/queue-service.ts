import type { ActorType, Prisma, TokenStatus } from "@prisma/client";
import type {
  BranchHistoryItemDto,
  BranchHistoryPageDto,
  BranchQueueOverviewDto,
  QueueTokenItemDto,
  StaffQueueAction,
} from "@/features/queue/types";
import type { BranchHistoryQueryInput, WalkInTokenInput } from "@/features/queue/schemas";
import { getBusinessDateForTimezone } from "@/lib/date";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { maskMobileNumber } from "@/lib/phone";
import {
  buildTransitionTimestamps,
  type QueueAction,
  type TransitionActorType,
  validateTokenTransition,
} from "@/lib/queue-state-machine";
import type { AuthorizedTenantContext } from "@/server/auth";
import { withBranchDb, type DbClient } from "@/server/db";
import { nudgeOutboxWorker } from "@/server/jobs/runner";
import { getRealtimeHub } from "@/server/realtime";
import {
  allocateNextQueueTokenNumber,
  type CreateTokenResult,
  generateOpaqueTokenPublicId,
  issueBranchToken,
  resolveEffectiveBranchSettings,
  type TokenCommittedEvent,
} from "./token-service";
import { computeBranchWaitSnapshot } from "./wait-time-service";

export interface QueueMutationMeta {
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
  onQueueMutated?: (event: QueueMutatedEvent) => Promise<void> | void;
}

export interface QueueMutatedEvent {
  organizationId: string;
  branchId: string;
  tokenId: string;
  tokenNumber: string;
  status: TokenStatus;
  action: QueueAction | "REQUEUE";
}

export interface CallNextResult {
  token: QueueTokenItemDto;
}

export interface TransitionTokenResult {
  token: {
    id: string;
    publicId: string;
    tokenNumber: string;
    fromStatus: TokenStatus;
    status: TokenStatus;
    calledAt: string | null;
    serviceStartedAt: string | null;
    completedAt: string | null;
    skippedAt: string | null;
    cancelledAt: string | null;
    noShowAt: string | null;
  };
}

export interface RequeueSkippedResult {
  originalTokenId: string;
  originalTokenNumber: string;
  requeuedToken: QueueTokenItemDto;
}

interface BranchContextRecord {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  qrToken: string;
  isActive: boolean;
  organizationSlug: string;
}

interface HistoryCursor {
  createdAt: string;
  id: string;
}

function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeHistoryCursor(rawCursor: string): HistoryCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(rawCursor, "base64url").toString("utf8"),
    ) as Partial<HistoryCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      throw new ValidationError("Invalid pagination cursor.");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError("Invalid pagination cursor.");
  }
}

function resolveStaffActorType(ctx: AuthorizedTenantContext): TransitionActorType {
  return ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF";
}

async function resolveBranchForQueue(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
): Promise<BranchContextRecord> {
  const branch = await tx.branch.findFirst({
    where: { id: branchId, organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      qrToken: true,
      isActive: true,
      organization: {
        select: { slug: true, status: true },
      },
    },
  });

  if (!branch) {
    throw new NotFoundError("Branch was not found.");
  }

  if (branch.organization.status !== "ACTIVE") {
    throw new ForbiddenError(
      "TENANT_SUSPENDED",
      "This organization is suspended and cannot process queue actions.",
    );
  }

  return {
    id: branch.id,
    name: branch.name,
    slug: branch.slug,
    timezone: branch.timezone,
    qrToken: branch.qrToken,
    isActive: branch.isActive,
    organizationSlug: branch.organization.slug,
  };
}

async function runPostCommitQueueHook(
  hook: ((event: QueueMutatedEvent) => Promise<void> | void) | undefined,
  event: QueueMutatedEvent,
): Promise<void> {
  nudgeOutboxWorker();
  getRealtimeHub().publishQueueMutation({
    organizationId: event.organizationId,
    branchId: event.branchId,
    tokenId: event.tokenId,
    tokenNumber: event.tokenNumber,
    action: event.action,
    timestamp: new Date().toISOString(),
  });
  if (!hook) return;
  try {
    await hook(event);
  } catch (hookError) {
    logger.warn(
      {
        err: hookError,
        organizationId: event.organizationId,
        branchId: event.branchId,
        tokenId: event.tokenId,
        action: event.action,
      },
      "Post-commit queue hook failed; queue mutation preserved",
    );
  }
}

/**
 * Evaluates active WAITING tokens after queue advancement and idempotently
 * enqueues `CUSTOMER_APPROACHING_1` / `CUSTOMER_APPROACHING_3` outbox rows.
 */
async function enqueueApproachingOutboxNotifications(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    branchId: string;
    branchName: string;
    organizationSlug: string;
    branchSlug: string;
    businessDate: Date;
    activeStationsCount: number;
    bufferMinutes: number;
    customerPushThresholds: number[];
    now: Date;
  },
): Promise<void> {
  const snapshot = await computeBranchWaitSnapshot(tx, {
    organizationId: params.organizationId,
    branchId: params.branchId,
    businessDate: params.businessDate,
    activeStationsCount: params.activeStationsCount,
    bufferMinutes: params.bufferMinutes,
    now: params.now,
  });

  if (snapshot.waitingCount === 0) {
    return;
  }

  const waitingTokens = await tx.token.findMany({
    where: {
      organizationId: params.organizationId,
      branchId: params.branchId,
      businessDate: params.businessDate,
      status: "WAITING",
    },
    orderBy: [{ sequenceNumber: "asc" }],
    select: {
      id: true,
      publicId: true,
      tokenNumber: true,
      customerNameSnapshot: true,
    },
  });

  const thresholds = new Set(params.customerPushThresholds);
  const eventsToCreate: Prisma.NotificationEventCreateManyInput[] = [];

  for (const waiting of waitingTokens) {
    const metrics = snapshot.byTokenId.get(waiting.id);
    if (!metrics) continue;

    let milestone: "APPROACHING_1" | "APPROACHING_3" | null = null;
    if (
      thresholds.has(1) &&
      (metrics.peopleAhead <= 1 || metrics.estimatedWaitMinutes <= 5)
    ) {
      milestone = "APPROACHING_1";
    } else if (thresholds.has(3) && metrics.peopleAhead <= 3 && metrics.peopleAhead > 1) {
      milestone = "APPROACHING_3";
    }

    if (!milestone) continue;

    const eventType =
      milestone === "APPROACHING_1" ? "CUSTOMER_APPROACHING_1" : "CUSTOMER_APPROACHING_3";

    eventsToCreate.push({
      organizationId: params.organizationId,
      branchId: params.branchId,
      tokenId: waiting.id,
      eventType,
      idempotencyKey: `token:${waiting.id}:${milestone}`,
      status: "PENDING",
      payload: {
        tokenId: waiting.id,
        publicId: waiting.publicId,
        tokenNumber: waiting.tokenNumber,
        branchId: params.branchId,
        branchName: params.branchName,
        customerName: waiting.customerNameSnapshot,
        peopleAhead: metrics.peopleAhead,
        estimatedWaitMinutes: metrics.estimatedWaitMinutes,
        targetUrl: `/salon/${params.organizationSlug}/${params.branchSlug}/token/${waiting.publicId}`,
      },
    });
  }

  if (eventsToCreate.length > 0) {
    await tx.notificationEvent.createMany({
      data: eventsToCreate,
      skipDuplicates: true,
    });
  }
}

function mapTokenRecordToQueueDto(
  row: {
    id: string;
    publicId: string;
    tokenNumber: string;
    sequenceNumber: number;
    status: TokenStatus;
    source: "QR" | "WALK_IN";
    customerNameSnapshot: string;
    customerMobileSnapshot: string;
    notes: string | null;
    totalPriceInPaise: number;
    totalDurationMinutes: number;
    requeuedFromTokenId: string | null;
    createdAt: Date;
    calledAt: Date | null;
    serviceStartedAt: Date | null;
    skippedAt: Date | null;
    tokenServices: Array<{
      serviceId: string;
      serviceNameSnapshot: string;
      priceInPaiseSnapshot: number;
      durationMinutesSnapshot: number;
    }>;
  },
  waitMetrics?: {
    estimatedWaitMinutes: number;
    peopleAhead: number;
    queuePosition: number;
  },
): QueueTokenItemDto {
  return {
    id: row.id,
    publicId: row.publicId,
    tokenNumber: row.tokenNumber,
    sequenceNumber: row.sequenceNumber,
    status: row.status,
    source: row.source,
    customerName: row.customerNameSnapshot,
    customerMobile: row.customerMobileSnapshot,
    notes: row.notes,
    totalPriceInPaise: row.totalPriceInPaise,
    totalDurationMinutes: row.totalDurationMinutes,
    estimatedWaitMinutes: waitMetrics?.estimatedWaitMinutes ?? 0,
    peopleAhead: waitMetrics?.peopleAhead ?? 0,
    queuePosition: waitMetrics?.queuePosition ?? 0,
    requeuedFromTokenId: row.requeuedFromTokenId,
    createdAt: row.createdAt.toISOString(),
    calledAt: row.calledAt ? row.calledAt.toISOString() : null,
    serviceStartedAt: row.serviceStartedAt ? row.serviceStartedAt.toISOString() : null,
    skippedAt: row.skippedAt ? row.skippedAt.toISOString() : null,
    services: row.tokenServices.map((svc) => ({
      serviceId: svc.serviceId,
      serviceName: svc.serviceNameSnapshot,
      priceInPaise: svc.priceInPaiseSnapshot,
      durationMinutes: svc.durationMinutesSnapshot,
    })),
  };
}

/**
 * Atomic strict-FIFO `Call Next` (`FOR UPDATE SKIP LOCKED` ordered by `sequence_number ASC`).
 */
export async function callNextToken(
  ctx: AuthorizedTenantContext,
  branchId: string,
  meta: QueueMutationMeta = {},
): Promise<CallNextResult> {
  const now = meta.now ?? new Date();
  const actorType = resolveStaffActorType(ctx);

  const outcome = await withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => {
      const branch = await resolveBranchForQueue(tx, ctx.organizationId, branchId);
      const settings = await resolveEffectiveBranchSettings(
        tx,
        ctx.organizationId,
        branchId,
      );
      const businessDate = getBusinessDateForTimezone(
        branch.timezone,
        now,
        settings.dayResetTime,
      );
      const businessDateIso = businessDate.toISOString().slice(0, 10);

      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "tokens"
        WHERE "organization_id" = ${ctx.organizationId}::uuid
          AND "branch_id" = ${branchId}::uuid
          AND "business_date" = ${businessDateIso}::date
          AND "status" = 'WAITING'
        ORDER BY "sequence_number" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      const nextTokenId = lockedRows[0]?.id;
      if (!nextTokenId) {
        throw new ConflictError(
          "NO_WAITING_CUSTOMERS",
          "No customers are currently waiting in this branch queue.",
        );
      }

      const updated = await tx.token.update({
        where: { id: nextTokenId },
        data: {
          status: "CALLED",
          calledAt: now,
        },
        select: {
          id: true,
          publicId: true,
          tokenNumber: true,
          sequenceNumber: true,
          status: true,
          source: true,
          customerNameSnapshot: true,
          customerMobileSnapshot: true,
          notes: true,
          totalPriceInPaise: true,
          totalDurationMinutes: true,
          requeuedFromTokenId: true,
          createdAt: true,
          calledAt: true,
          serviceStartedAt: true,
          skippedAt: true,
          tokenServices: {
            select: {
              serviceId: true,
              serviceNameSnapshot: true,
              priceInPaiseSnapshot: true,
              durationMinutesSnapshot: true,
            },
          },
        },
      });

      await tx.notificationEvent.createMany({
        data: [
          {
            organizationId: ctx.organizationId,
            branchId,
            tokenId: updated.id,
            eventType: "TOKEN_CALLED",
            idempotencyKey: `token:${updated.id}:CALLED`,
            status: "PENDING",
            payload: {
              tokenId: updated.id,
              publicId: updated.publicId,
              tokenNumber: updated.tokenNumber,
              branchId,
              branchName: branch.name,
              customerName: updated.customerNameSnapshot,
              targetUrl: `/salon/${branch.organizationSlug}/${branch.slug}/token/${updated.publicId}`,
            },
          },
          {
            organizationId: ctx.organizationId,
            branchId,
            tokenId: updated.id,
            eventType: "CUSTOMER_CALLED",
            idempotencyKey: `token:${updated.id}:CUSTOMER_CALLED`,
            status: "PENDING",
            payload: {
              tokenId: updated.id,
              tokenNumber: updated.tokenNumber,
              branchId,
              branchName: branch.name,
              customerName: updated.customerNameSnapshot,
              maskedMobile: maskMobileNumber(updated.customerMobileSnapshot),
              targetUrl: `/owner/queue?branchId=${branchId}`,
            },
          },
        ],
        skipDuplicates: true,
      });

      await enqueueApproachingOutboxNotifications(tx, {
        organizationId: ctx.organizationId,
        branchId,
        branchName: branch.name,
        organizationSlug: branch.organizationSlug,
        branchSlug: branch.slug,
        businessDate,
        activeStationsCount: settings.activeStationsCount,
        bufferMinutes: settings.estimatedBufferMinutes,
        customerPushThresholds: settings.customerPushThresholds,
        now,
      });

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          branchId,
          actorType,
          actorId: ctx.userId,
          action: "TOKEN_CALLED",
          entityType: "TOKEN",
          entityId: updated.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: {
            tokenNumber: updated.tokenNumber,
            sequenceNumber: updated.sequenceNumber,
            fromStatus: "WAITING",
            toStatus: "CALLED",
          },
        },
      });

      return {
        dto: mapTokenRecordToQueueDto(updated, {
          estimatedWaitMinutes: 0,
          peopleAhead: 0,
          queuePosition: 1,
        }),
      };
    },
    meta.client,
  );

  await runPostCommitQueueHook(meta.onQueueMutated, {
    organizationId: ctx.organizationId,
    branchId,
    tokenId: outcome.dto.id,
    tokenNumber: outcome.dto.tokenNumber,
    status: "CALLED",
    action: "CALL_NEXT",
  });

  return { token: outcome.dto };
}

/**
 * Transitions a token across the 7-status state machine under a PostgreSQL `FOR UPDATE` lock.
 * Shared across authenticated staff transitions (`START_SERVICE`, `COMPLETE`, `SKIP`, `CANCEL`,
 * `MARK_NO_SHOW`) and customer self-cancellation (`actorType = "CUSTOMER"`, `action = "CANCEL"`).
 */
export async function transitionBranchToken(params: {
  organizationId: string;
  branchId: string;
  tokenId: string;
  action: StaffQueueAction;
  actorType: TransitionActorType;
  actorId?: string | null;
  reason?: string;
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
  onQueueMutated?: (event: QueueMutatedEvent) => Promise<void> | void;
}): Promise<TransitionTokenResult> {
  const now = params.now ?? new Date();

  const outcome = await withBranchDb(
    params.organizationId,
    params.branchId,
    async (tx) => {
      const branch = await resolveBranchForQueue(
        tx,
        params.organizationId,
        params.branchId,
      );
      const settings = await resolveEffectiveBranchSettings(
        tx,
        params.organizationId,
        params.branchId,
      );

      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "tokens"
        WHERE "id" = ${params.tokenId}::uuid
          AND "organization_id" = ${params.organizationId}::uuid
          AND "branch_id" = ${params.branchId}::uuid
        FOR UPDATE
      `;

      if (!lockedRows[0]) {
        throw new NotFoundError("Token was not found.");
      }

      const token = await tx.token.findUniqueOrThrow({
        where: { id: params.tokenId },
        select: {
          id: true,
          publicId: true,
          tokenNumber: true,
          businessDate: true,
          status: true,
          calledAt: true,
        },
      });

      const validated = validateTokenTransition({
        currentStatus: token.status,
        action: params.action,
        actorType: params.actorType,
        allowCustomerCancel: settings.allowCustomerCancel,
      });

      const timestamps = buildTransitionTimestamps({
        targetStatus: validated.toStatus,
        existingCalledAt: token.calledAt,
        now,
      });

      const updated = await tx.token.update({
        where: { id: token.id },
        data: {
          status: validated.toStatus,
          ...timestamps,
        },
        select: {
          id: true,
          publicId: true,
          tokenNumber: true,
          status: true,
          calledAt: true,
          serviceStartedAt: true,
          completedAt: true,
          skippedAt: true,
          cancelledAt: true,
          noShowAt: true,
        },
      });

      if (
        validated.toStatus === "COMPLETED" ||
        validated.toStatus === "CANCELLED" ||
        validated.toStatus === "NO_SHOW" ||
        validated.toStatus === "SKIPPED"
      ) {
        await tx.pushSubscription.updateMany({
          where: {
            organizationId: params.organizationId,
            tokenId: updated.id,
            isActive: true,
          },
          data: {
            isActive: false,
            revokedAt: now,
            revokedReason: "TOKEN_CLOSED",
          },
        });
      }

      if (
        validated.fromStatus === "WAITING" ||
        validated.fromStatus === "CALLED" ||
        validated.fromStatus === "IN_SERVICE"
      ) {
        await enqueueApproachingOutboxNotifications(tx, {
          organizationId: params.organizationId,
          branchId: params.branchId,
          branchName: branch.name,
          organizationSlug: branch.organizationSlug,
          branchSlug: branch.slug,
          businessDate: token.businessDate,
          activeStationsCount: settings.activeStationsCount,
          bufferMinutes: settings.estimatedBufferMinutes,
          customerPushThresholds: settings.customerPushThresholds,
          now,
        });
      }

      const auditActionMap: Record<TokenStatus, string> = {
        WAITING: "TOKEN_UPDATED",
        CALLED: "TOKEN_CALLED",
        IN_SERVICE: "TOKEN_STARTED",
        COMPLETED: "TOKEN_COMPLETED",
        SKIPPED: "TOKEN_SKIPPED",
        CANCELLED: "TOKEN_CANCELLED",
        NO_SHOW: "TOKEN_NO_SHOW",
      };

      const actorTypeEnum: ActorType = params.actorType;
      await tx.auditLog.create({
        data: {
          organizationId: params.organizationId,
          branchId: params.branchId,
          actorType: actorTypeEnum,
          actorId: params.actorId ?? null,
          action: auditActionMap[validated.toStatus],
          entityType: "TOKEN",
          entityId: updated.id,
          ipAddressHash: params.ipAddressHash ?? null,
          userAgent: params.userAgent?.slice(0, 256) ?? null,
          metadata: {
            tokenNumber: updated.tokenNumber,
            action: params.action,
            fromStatus: validated.fromStatus,
            toStatus: validated.toStatus,
            ...(params.reason ? { reason: params.reason } : {}),
          },
        },
      });

      return {
        fromStatus: validated.fromStatus,
        updated,
      };
    },
    params.client,
  );

  await runPostCommitQueueHook(params.onQueueMutated, {
    organizationId: params.organizationId,
    branchId: params.branchId,
    tokenId: outcome.updated.id,
    tokenNumber: outcome.updated.tokenNumber,
    status: outcome.updated.status,
    action: params.action,
  });

  return {
    token: {
      id: outcome.updated.id,
      publicId: outcome.updated.publicId,
      tokenNumber: outcome.updated.tokenNumber,
      fromStatus: outcome.fromStatus,
      status: outcome.updated.status,
      calledAt: outcome.updated.calledAt ? outcome.updated.calledAt.toISOString() : null,
      serviceStartedAt: outcome.updated.serviceStartedAt
        ? outcome.updated.serviceStartedAt.toISOString()
        : null,
      completedAt: outcome.updated.completedAt
        ? outcome.updated.completedAt.toISOString()
        : null,
      skippedAt: outcome.updated.skippedAt
        ? outcome.updated.skippedAt.toISOString()
        : null,
      cancelledAt: outcome.updated.cancelledAt
        ? outcome.updated.cancelledAt.toISOString()
        : null,
      noShowAt: outcome.updated.noShowAt ? outcome.updated.noShowAt.toISOString() : null,
    },
  };
}

/**
 * Staff/owner manual walk-in token creation (`source = "WALK_IN"`), delegating
 * atomically to `TokenService.issueBranchToken()` without public QR/hours gates.
 */
export async function createWalkInToken(
  ctx: AuthorizedTenantContext,
  branchId: string,
  input: WalkInTokenInput,
  meta: {
    ipAddressHash?: string;
    userAgent?: string;
    now?: Date;
    client?: DbClient;
    onTokenCommitted?: (event: TokenCommittedEvent) => Promise<void> | void;
  } = {},
): Promise<CreateTokenResult> {
  const branch = await withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => resolveBranchForQueue(tx, ctx.organizationId, branchId),
    meta.client,
  );

  if (!branch.isActive) {
    throw new ForbiddenError(
      "BRANCH_NOT_ACCEPTING",
      "This branch is currently inactive and cannot issue walk-in tokens.",
    );
  }

  return issueBranchToken({
    organizationId: ctx.organizationId,
    organizationSlug: branch.organizationSlug,
    branchId: branch.id,
    branchName: branch.name,
    branchSlug: branch.slug,
    branchTimezone: branch.timezone,
    branchQrToken: branch.qrToken,
    fullName: input.fullName,
    mobileNumber: input.mobileNumber,
    serviceIds: input.serviceIds,
    notes: input.notes,
    idempotencyKey: input.idempotencyKey,
    source: "WALK_IN",
    actorType: resolveStaffActorType(ctx),
    actorId: ctx.userId,
    enforcePublicIntakeRules: false,
    ipAddressHash: meta.ipAddressHash,
    userAgent: meta.userAgent,
    now: meta.now,
    client: meta.client,
    onTokenCommitted: meta.onTokenCommitted,
  });
}

/**
 * Preserves an existing `SKIPPED` token untouched in history and atomically allocates
 * a new tail `QueueCounter` sequence number at the back of `WAITING` (`TOKEN_REQUEUED`).
 */
export async function requeueSkippedToken(
  ctx: AuthorizedTenantContext,
  branchId: string,
  tokenId: string,
  meta: QueueMutationMeta = {},
): Promise<RequeueSkippedResult> {
  const now = meta.now ?? new Date();
  const actorType = resolveStaffActorType(ctx);

  const outcome = await withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => {
      const branch = await resolveBranchForQueue(tx, ctx.organizationId, branchId);
      const settings = await resolveEffectiveBranchSettings(
        tx,
        ctx.organizationId,
        branchId,
      );

      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "tokens"
        WHERE "id" = ${tokenId}::uuid
          AND "organization_id" = ${ctx.organizationId}::uuid
          AND "branch_id" = ${branchId}::uuid
        FOR UPDATE
      `;

      if (!lockedRows[0]) {
        throw new NotFoundError("Token was not found.");
      }

      const original = await tx.token.findUniqueOrThrow({
        where: { id: tokenId },
        select: {
          id: true,
          tokenNumber: true,
          status: true,
          source: true,
          customerId: true,
          customerNameSnapshot: true,
          customerMobileSnapshot: true,
          notes: true,
          totalPriceInPaise: true,
          totalDurationMinutes: true,
          requeuedToToken: { select: { id: true } },
          tokenServices: {
            select: {
              serviceId: true,
              serviceNameSnapshot: true,
              priceInPaiseSnapshot: true,
              durationMinutesSnapshot: true,
            },
          },
        },
      });

      if (original.status !== "SKIPPED") {
        throw new ConflictError(
          "INVALID_STATE_TRANSITION",
          "Only skipped tokens can be re-queued.",
        );
      }

      if (original.requeuedToToken) {
        throw new ConflictError(
          "INVALID_STATE_TRANSITION",
          "This skipped token has already been re-queued.",
        );
      }

      if (!settings.allowDuplicateActiveTokens) {
        const activeToken = await tx.token.findFirst({
          where: {
            organizationId: ctx.organizationId,
            branchId,
            customerId: original.customerId,
            status: { in: ["WAITING", "CALLED", "IN_SERVICE"] },
          },
          select: { id: true },
        });
        if (activeToken) {
          throw new ConflictError(
            "ACTIVE_TOKEN_EXISTS",
            "Customer already has an active token in the queue.",
          );
        }
      }

      const businessDate = getBusinessDateForTimezone(
        branch.timezone,
        now,
        settings.dayResetTime,
      );
      const { sequenceNumber, tokenNumber } = await allocateNextQueueTokenNumber(tx, {
        organizationId: ctx.organizationId,
        branchId,
        businessDate,
        tokenPrefix: settings.tokenPrefix,
      });

      const publicId = generateOpaqueTokenPublicId();

      const newToken = await tx.token.create({
        data: {
          publicId,
          organizationId: ctx.organizationId,
          branchId,
          customerId: original.customerId,
          businessDate,
          sequenceNumber,
          tokenNumber,
          source: original.source,
          requeuedFromTokenId: original.id,
          customerNameSnapshot: original.customerNameSnapshot,
          customerMobileSnapshot: original.customerMobileSnapshot,
          notes: original.notes,
          status: "WAITING",
          totalPriceInPaise: original.totalPriceInPaise,
          totalDurationMinutes: original.totalDurationMinutes,
        },
        select: {
          id: true,
          publicId: true,
          tokenNumber: true,
          sequenceNumber: true,
          status: true,
          source: true,
          customerNameSnapshot: true,
          customerMobileSnapshot: true,
          notes: true,
          totalPriceInPaise: true,
          totalDurationMinutes: true,
          requeuedFromTokenId: true,
          createdAt: true,
          calledAt: true,
          serviceStartedAt: true,
          skippedAt: true,
        },
      });

      if (original.tokenServices.length > 0) {
        await tx.tokenService.createMany({
          data: original.tokenServices.map((svc) => ({
            organizationId: ctx.organizationId,
            tokenId: newToken.id,
            serviceId: svc.serviceId,
            serviceNameSnapshot: svc.serviceNameSnapshot,
            priceInPaiseSnapshot: svc.priceInPaiseSnapshot,
            durationMinutesSnapshot: svc.durationMinutesSnapshot,
          })),
        });
      }

      // Migrate active customer push subscriptions from the original skipped token
      // to the new re-queued token so customer receives TOKEN_REQUEUED and all milestone alerts.
      const previousSubscriptions = await tx.pushSubscription.findMany({
        where: {
          organizationId: ctx.organizationId,
          tokenId: original.id,
          subscriberType: "CUSTOMER",
          OR: [{ revokedReason: "TOKEN_CLOSED" }, { isActive: true }],
        },
        select: {
          endpoint: true,
          p256dh: true,
          auth: true,
          deviceLabel: true,
          preferences: true,
          consentGivenAt: true,
        },
      });

      if (previousSubscriptions.length > 0) {
        const uniqueByEndpoint = new Map<
          string,
          (typeof previousSubscriptions)[number]
        >();
        for (const sub of previousSubscriptions) {
          if (!uniqueByEndpoint.has(sub.endpoint)) {
            uniqueByEndpoint.set(sub.endpoint, sub);
          }
        }

        await tx.pushSubscription.createMany({
          data: Array.from(uniqueByEndpoint.values()).map((sub) => ({
            organizationId: ctx.organizationId,
            branchId,
            subscriberType: "CUSTOMER",
            tokenId: newToken.id,
            endpoint: sub.endpoint,
            p256dh: sub.p256dh,
            auth: sub.auth,
            deviceLabel: sub.deviceLabel,
            preferences: sub.preferences
              ? (sub.preferences as Prisma.InputJsonValue)
              : undefined,
            consentGivenAt: sub.consentGivenAt ?? now,
            isActive: true,
            revokedAt: null,
            revokedReason: null,
          })),
        });
      }

      const waitSnapshot = await computeBranchWaitSnapshot(tx, {
        organizationId: ctx.organizationId,
        branchId,
        businessDate,
        activeStationsCount: settings.activeStationsCount,
        bufferMinutes: settings.estimatedBufferMinutes,
        now,
      });

      await tx.notificationEvent.create({
        data: {
          organizationId: ctx.organizationId,
          branchId,
          tokenId: newToken.id,
          eventType: "TOKEN_REQUEUED",
          idempotencyKey: `token:${newToken.id}:REQUEUED`,
          status: "PENDING",
          payload: {
            tokenId: newToken.id,
            publicId: newToken.publicId,
            tokenNumber: newToken.tokenNumber,
            originalTokenId: original.id,
            originalTokenNumber: original.tokenNumber,
            branchId,
            branchName: branch.name,
            customerName: newToken.customerNameSnapshot,
            targetUrl: `/salon/${branch.organizationSlug}/${branch.slug}/token/${newToken.publicId}`,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          branchId,
          actorType,
          actorId: ctx.userId,
          action: "TOKEN_REQUEUED",
          entityType: "TOKEN",
          entityId: newToken.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
          metadata: {
            originalTokenId: original.id,
            originalTokenNumber: original.tokenNumber,
            newTokenId: newToken.id,
            newTokenNumber: newToken.tokenNumber,
            sequenceNumber: newToken.sequenceNumber,
          },
        },
      });

      return {
        originalTokenId: original.id,
        originalTokenNumber: original.tokenNumber,
        requeuedToken: mapTokenRecordToQueueDto(
          {
            ...newToken,
            tokenServices: original.tokenServices,
          },
          waitSnapshot.byTokenId.get(newToken.id),
        ),
      };
    },
    meta.client,
  );

  await runPostCommitQueueHook(meta.onQueueMutated, {
    organizationId: ctx.organizationId,
    branchId,
    tokenId: outcome.requeuedToken.id,
    tokenNumber: outcome.requeuedToken.tokenNumber,
    status: "WAITING",
    action: "REQUEUE",
  });

  return outcome;
}

/**
 * Single-query conditional KPI aggregation + live FIFO queue groups + un-requeued SKIPPED tokens.
 */
export async function getBranchQueueOverview(
  ctx: AuthorizedTenantContext,
  branchId: string,
  options: { now?: Date; client?: DbClient } = {},
): Promise<BranchQueueOverviewDto> {
  const now = options.now ?? new Date();

  return withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => {
      const branch = await resolveBranchForQueue(tx, ctx.organizationId, branchId);
      const settings = await resolveEffectiveBranchSettings(
        tx,
        ctx.organizationId,
        branchId,
      );
      const businessDate = getBusinessDateForTimezone(
        branch.timezone,
        now,
        settings.dayResetTime,
      );
      const businessDateIso = businessDate.toISOString().slice(0, 10);

      const [kpiRows, queueRows, waitSnapshot] = await Promise.all([
        tx.$queryRaw<
          Array<{
            total_tokens: bigint;
            waiting_count: bigint;
            called_count: bigint;
            in_service_count: bigint;
            completed_count: bigint;
            skipped_count: bigint;
            cancelled_no_show_count: bigint;
            avg_wait_minutes: number | null;
            avg_service_minutes: number | null;
            revenue_in_paise: bigint;
          }>
        >`
          SELECT
            COUNT(*)::bigint AS "total_tokens",
            COUNT(*) FILTER (WHERE "status" = 'WAITING')::bigint AS "waiting_count",
            COUNT(*) FILTER (WHERE "status" = 'CALLED')::bigint AS "called_count",
            COUNT(*) FILTER (WHERE "status" = 'IN_SERVICE')::bigint AS "in_service_count",
            COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::bigint AS "completed_count",
            COUNT(*) FILTER (WHERE "status" = 'SKIPPED')::bigint AS "skipped_count",
            COUNT(*) FILTER (WHERE "status" IN ('CANCELLED', 'NO_SHOW'))::bigint AS "cancelled_no_show_count",
            AVG(EXTRACT(EPOCH FROM ("service_started_at" - "created_at")) / 60.0)
              FILTER (WHERE "service_started_at" IS NOT NULL) AS "avg_wait_minutes",
            AVG(EXTRACT(EPOCH FROM ("completed_at" - "service_started_at")) / 60.0)
              FILTER (WHERE "completed_at" IS NOT NULL AND "service_started_at" IS NOT NULL) AS "avg_service_minutes",
            COALESCE(SUM("total_price_in_paise") FILTER (WHERE "status" = 'COMPLETED'), 0)::bigint AS "revenue_in_paise"
          FROM "tokens"
          WHERE "organization_id" = ${ctx.organizationId}::uuid
            AND "branch_id" = ${branchId}::uuid
            AND "business_date" = ${businessDateIso}::date
        `,
        tx.token.findMany({
          where: {
            organizationId: ctx.organizationId,
            branchId,
            businessDate,
            OR: [
              { status: { in: ["IN_SERVICE", "CALLED", "WAITING"] } },
              { status: "SKIPPED", requeuedToToken: { is: null } },
            ],
          },
          orderBy: [{ sequenceNumber: "asc" }],
          select: {
            id: true,
            publicId: true,
            tokenNumber: true,
            sequenceNumber: true,
            status: true,
            source: true,
            customerNameSnapshot: true,
            customerMobileSnapshot: true,
            notes: true,
            totalPriceInPaise: true,
            totalDurationMinutes: true,
            requeuedFromTokenId: true,
            createdAt: true,
            calledAt: true,
            serviceStartedAt: true,
            skippedAt: true,
            tokenServices: {
              select: {
                serviceId: true,
                serviceNameSnapshot: true,
                priceInPaiseSnapshot: true,
                durationMinutesSnapshot: true,
              },
            },
          },
        }),
        computeBranchWaitSnapshot(tx, {
          organizationId: ctx.organizationId,
          branchId,
          businessDate,
          activeStationsCount: settings.activeStationsCount,
          bufferMinutes: settings.estimatedBufferMinutes,
          now,
        }),
      ]);

      const inServiceTokens = queueRows
        .filter((row) => row.status === "IN_SERVICE")
        .sort(
          (a, b) =>
            (a.serviceStartedAt?.getTime() ?? 0) - (b.serviceStartedAt?.getTime() ?? 0),
        )
        .map((row) => mapTokenRecordToQueueDto(row, waitSnapshot.byTokenId.get(row.id)));

      const calledTokens = queueRows
        .filter((row) => row.status === "CALLED")
        .sort(
          (a, b) =>
            (a.calledAt?.getTime() ?? 0) - (b.calledAt?.getTime() ?? 0) ||
            a.sequenceNumber - b.sequenceNumber,
        )
        .map((row) => mapTokenRecordToQueueDto(row, waitSnapshot.byTokenId.get(row.id)));

      const waitingTokens = queueRows
        .filter((row) => row.status === "WAITING")
        .map((row) => mapTokenRecordToQueueDto(row, waitSnapshot.byTokenId.get(row.id)));

      const skippedTokens = queueRows
        .filter((row) => row.status === "SKIPPED")
        .sort(
          (a, b) =>
            (b.skippedAt?.getTime() ?? 0) - (a.skippedAt?.getTime() ?? 0) ||
            a.sequenceNumber - b.sequenceNumber,
        )
        .map((row) => mapTokenRecordToQueueDto(row));

      const kpi = kpiRows[0];

      return {
        branchId,
        businessDate: businessDateIso,
        isAcceptingTokens: settings.isAcceptingTokens,
        queuePausedReason: settings.queuePausedReason,
        activeStationsCount: settings.activeStationsCount,
        estimatedNewJoinWaitMinutes: waitSnapshot.estimatedNewJoinWaitMinutes,
        kpis: {
          totalTokens: Number(kpi?.total_tokens ?? 0),
          waitingCount: Number(kpi?.waiting_count ?? 0),
          calledCount: Number(kpi?.called_count ?? 0),
          inServiceCount: Number(kpi?.in_service_count ?? 0),
          completedCount: Number(kpi?.completed_count ?? 0),
          skippedCount: Number(kpi?.skipped_count ?? 0),
          cancelledNoShowCount: Number(kpi?.cancelled_no_show_count ?? 0),
          avgWaitMinutes: kpi?.avg_wait_minutes
            ? Math.round(Number(kpi.avg_wait_minutes))
            : 0,
          avgServiceMinutes: kpi?.avg_service_minutes
            ? Math.round(Number(kpi.avg_service_minutes))
            : 0,
          revenueInPaise: Number(kpi?.revenue_in_paise ?? 0),
        },
        inServiceTokens,
        calledTokens,
        waitingTokens,
        skippedTokens,
      };
    },
    options.client,
  );
}

/**
 * Bounded keyset-paginated (`limit <= 50`) branch token ledger ordered by
 * `(createdAt DESC, id DESC)`.
 */
export async function getBranchTokenHistory(
  ctx: AuthorizedTenantContext,
  branchId: string,
  query: BranchHistoryQueryInput,
  client?: DbClient,
): Promise<BranchHistoryPageDto> {
  const limit = Math.min(50, Math.max(1, query.limit ?? 25));
  const cursor = query.cursor ? decodeHistoryCursor(query.cursor) : null;

  return withBranchDb(
    ctx.organizationId,
    branchId,
    async (tx) => {
      await resolveBranchForQueue(tx, ctx.organizationId, branchId);

      const conditions: Prisma.TokenWhereInput[] = [
        { organizationId: ctx.organizationId, branchId },
      ];

      if (query.dateFrom || query.dateTo) {
        conditions.push({
          businessDate: {
            ...(query.dateFrom
              ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) }
              : {}),
            ...(query.dateTo ? { lte: new Date(`${query.dateTo}T00:00:00.000Z`) } : {}),
          },
        });
      }

      if (query.status && query.status !== "ALL") {
        conditions.push({ status: query.status });
      }

      if (query.search && query.search.trim().length > 0) {
        const term = query.search.trim();
        conditions.push({
          OR: [
            { tokenNumber: { contains: term, mode: "insensitive" } },
            { customerNameSnapshot: { contains: term, mode: "insensitive" } },
            { customerMobileSnapshot: { contains: term } },
          ],
        });
      }

      if (cursor) {
        const cursorCreatedAt = new Date(cursor.createdAt);
        conditions.push({
          OR: [
            { createdAt: { lt: cursorCreatedAt } },
            {
              createdAt: cursorCreatedAt,
              id: { lt: cursor.id },
            },
          ],
        });
      }

      const rows = await tx.token.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          publicId: true,
          tokenNumber: true,
          businessDate: true,
          sequenceNumber: true,
          status: true,
          source: true,
          customerNameSnapshot: true,
          customerMobileSnapshot: true,
          notes: true,
          totalPriceInPaise: true,
          totalDurationMinutes: true,
          requeuedFromTokenId: true,
          requeuedToToken: { select: { id: true } },
          createdAt: true,
          calledAt: true,
          serviceStartedAt: true,
          completedAt: true,
          skippedAt: true,
          cancelledAt: true,
          noShowAt: true,
          tokenServices: {
            select: {
              serviceId: true,
              serviceNameSnapshot: true,
              priceInPaiseSnapshot: true,
              durationMinutesSnapshot: true,
            },
          },
        },
      });

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = pageRows[pageRows.length - 1];

      const items: BranchHistoryItemDto[] = pageRows.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        tokenNumber: row.tokenNumber,
        businessDate: row.businessDate.toISOString().slice(0, 10),
        sequenceNumber: row.sequenceNumber,
        status: row.status,
        source: row.source,
        customerName: row.customerNameSnapshot,
        customerMobile: row.customerMobileSnapshot,
        notes: row.notes,
        totalPriceInPaise: row.totalPriceInPaise,
        totalDurationMinutes: row.totalDurationMinutes,
        requeuedFromTokenId: row.requeuedFromTokenId,
        requeuedToTokenId: row.requeuedToToken?.id ?? null,
        createdAt: row.createdAt.toISOString(),
        calledAt: row.calledAt ? row.calledAt.toISOString() : null,
        serviceStartedAt: row.serviceStartedAt
          ? row.serviceStartedAt.toISOString()
          : null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        skippedAt: row.skippedAt ? row.skippedAt.toISOString() : null,
        cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
        noShowAt: row.noShowAt ? row.noShowAt.toISOString() : null,
        services: row.tokenServices.map((svc) => ({
          serviceId: svc.serviceId,
          serviceName: svc.serviceNameSnapshot,
          priceInPaise: svc.priceInPaiseSnapshot,
          durationMinutes: svc.durationMinutesSnapshot,
        })),
      }));

      return {
        items,
        hasMore,
        nextCursor:
          hasMore && lastRow
            ? encodeHistoryCursor({
                createdAt: lastRow.createdAt.toISOString(),
                id: lastRow.id,
              })
            : null,
      };
    },
    client,
  );
}
