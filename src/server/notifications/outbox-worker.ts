import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { formatPushNotificationMessage } from "@/lib/push-validation";
import { withSystemDb, withTenantDb, type DbClient } from "@/server/db";
import {
  defaultPushTransport,
  type PushSendResult,
  type PushTransport,
} from "./web-push-adapter";

const RETRY_DELAYS_SECONDS = [15, 60, 300, 900] as const;

const OWNER_STAFF_EVENT_TYPES = new Set([
  "NEW_TOKEN_OWNER_ALERT",
  "NEW_TOKEN_CREATED",
  "CUSTOMER_CALLED",
  "QUEUE_LONG_THRESHOLD",
  "OWNER_TEST_PUSH",
  "NOTIFICATION_DELIVERY_FAILURE",
]);

export interface ClaimedOutboxEvent {
  id: string;
  organizationId: string;
  branchId: string | null;
  tokenId: string | null;
  eventType: string;
  payload: Prisma.JsonValue;
  attemptCount: number;
  maxAttempts: number;
}

export interface OutboxBatchSummary {
  claimed: number;
  processed: number;
  retrying: number;
  deadLettered: number;
  deliveriesSucceeded: number;
  subscriptionsExpired: number;
}

interface PendingDispatchTask {
  notificationId: string;
  pushSubscriptionId: string;
  attemptNumber: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  targetUrl: string;
  tag: string;
}

export function computeRetryBackoffMs(
  failedAttemptCount: number,
  jitterMultiplier = 1.0,
): number {
  const index = Math.min(
    RETRY_DELAYS_SECONDS.length - 1,
    Math.max(0, failedAttemptCount - 1),
  );
  const baseSeconds = RETRY_DELAYS_SECONDS[index] ?? 900;
  return Math.round(baseSeconds * 1000 * jitterMultiplier);
}

function asPayloadRecord(payload: Prisma.JsonValue): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

async function resolveEligibleSubscriptions(
  tx: Prisma.TransactionClient,
  event: ClaimedOutboxEvent,
  payloadRecord: Record<string, unknown>,
) {
  let candidates: Array<{
    id: string;
    userId: string | null;
    endpoint: string;
    p256dh: string;
    auth: string;
    preferences: Prisma.JsonValue | null;
  }> = [];

  if (OWNER_STAFF_EVENT_TYPES.has(event.eventType)) {
    const specificUserId =
      typeof payloadRecord.recipientUserId === "string"
        ? payloadRecord.recipientUserId
        : null;
    const specificSubId =
      typeof payloadRecord.subscriptionId === "string"
        ? payloadRecord.subscriptionId
        : null;

    // Resolve ONLY active OrganizationMembers authorized for this branch (`NT-06`).
    const activeMembers = await tx.organizationMember.findMany({
      where: {
        organizationId: event.organizationId,
        status: "ACTIVE",
        ...(specificUserId ? { userId: specificUserId } : {}),
        ...(event.branchId && !specificUserId
          ? {
              OR: [
                { allBranches: true },
                { branchAccess: { some: { branchId: event.branchId } } },
              ],
            }
          : {}),
      },
      select: { userId: true },
    });

    const eligibleUserIds = [...new Set(activeMembers.map((m) => m.userId))];
    if (eligibleUserIds.length === 0) {
      return [];
    }

    const subs = await tx.pushSubscription.findMany({
      where: {
        organizationId: event.organizationId,
        subscriberType: "OWNER_STAFF",
        isActive: true,
        userId: { in: eligibleUserIds },
        ...(specificSubId ? { id: specificSubId } : {}),
        ...(event.branchId
          ? { OR: [{ branchId: null }, { branchId: event.branchId }] }
          : {}),
      },
      select: {
        id: true,
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
        preferences: true,
      },
    });

    candidates = subs.filter((sub) => {
      if (
        !sub.preferences ||
        typeof sub.preferences !== "object" ||
        Array.isArray(sub.preferences)
      ) {
        return true;
      }
      const prefs = sub.preferences as Record<string, unknown>;
      if (
        (event.eventType === "NEW_TOKEN_OWNER_ALERT" ||
          event.eventType === "NEW_TOKEN_CREATED") &&
        prefs.newToken === false
      ) {
        return false;
      }
      if (event.eventType === "QUEUE_LONG_THRESHOLD" && prefs.longQueue === false) {
        return false;
      }
      return true;
    });
  } else if (event.tokenId) {
    candidates = await tx.pushSubscription.findMany({
      where: {
        organizationId: event.organizationId,
        subscriberType: "CUSTOMER",
        tokenId: event.tokenId,
        isActive: true,
        token: {
          status: { in: ["WAITING", "CALLED", "IN_SERVICE"] },
        },
      },
      select: {
        id: true,
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
        preferences: true,
      },
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  // Deduplicate subscriptions by endpoint so physical devices never receive duplicate Web Push alerts
  const seenEndpoints = new Set<string>();
  const uniqueSubs: typeof candidates = [];
  for (const sub of candidates) {
    if (!seenEndpoints.has(sub.endpoint)) {
      seenEndpoints.add(sub.endpoint);
      uniqueSubs.push(sub);
    }
  }

  return uniqueSubs;
}

async function claimDueOutboxBatch(params: {
  batchSize: number;
  workerId: string;
  now: Date;
  client?: DbClient;
}): Promise<ClaimedOutboxEvent[]> {
  const lockedUntil = new Date(params.now.getTime() + 60_000);

  return withSystemDb(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        organization_id: string;
        branch_id: string | null;
        token_id: string | null;
        event_type: string;
        payload: Prisma.JsonValue;
        attempt_count: number;
        max_attempts: number;
      }>
    >`
      WITH claimed AS (
        SELECT "id"
        FROM "notification_events"
        WHERE "status" IN ('PENDING', 'RETRYING')
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${params.now})
          AND ("locked_until" IS NULL OR "locked_until" < ${params.now})
        ORDER BY "created_at" ASC
        LIMIT ${params.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "notification_events" e
      SET
        "status" = 'PROCESSING',
        "locked_until" = ${lockedUntil},
        "locked_by" = ${params.workerId},
        "updated_at" = NOW()
      FROM claimed
      WHERE e."id" = claimed."id"
      RETURNING
        e."id",
        e."organization_id",
        e."branch_id",
        e."token_id",
        e."event_type",
        e."payload",
        e."attempt_count",
        e."max_attempts"
    `;

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      branchId: row.branch_id,
      tokenId: row.token_id,
      eventType: row.event_type,
      payload: row.payload,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
    }));
  }, params.client);
}

async function processSingleEvent(params: {
  event: ClaimedOutboxEvent;
  transport: PushTransport;
  now: Date;
  enableJitter: boolean;
  client?: DbClient;
}): Promise<{
  finalStatus: "PROCESSED" | "RETRYING" | "DEAD_LETTER";
  deliveriesSucceeded: number;
  subscriptionsExpired: number;
}> {
  const { event, transport, now } = params;
  const payloadRecord = asPayloadRecord(event.payload);
  const formatted = formatPushNotificationMessage(event.eventType, payloadRecord);
  const nextAttemptNumber = event.attemptCount + 1;

  // Step 1: Prepare per-subscription Notification rows inside tenant DB transaction (no HTTP I/O).
  const dispatchTasks = await withTenantDb(
    event.organizationId,
    async (tx): Promise<PendingDispatchTask[]> => {
      const subscriptions = await resolveEligibleSubscriptions(tx, event, payloadRecord);
      if (subscriptions.length === 0) {
        return [];
      }

      const existingNotifications = await tx.notification.findMany({
        where: {
          organizationId: event.organizationId,
          notificationEventId: event.id,
        },
        select: {
          id: true,
          pushSubscriptionId: true,
          status: true,
        },
      });

      const bySubId = new Map(
        existingNotifications.map((n) => [n.pushSubscriptionId, n]),
      );

      const tasks: PendingDispatchTask[] = [];

      for (const sub of subscriptions) {
        const existing = bySubId.get(sub.id);
        if (
          existing &&
          (existing.status === "ACCEPTED_BY_PROVIDER" ||
            existing.status === "ACKNOWLEDGED")
        ) {
          continue;
        }

        const notifRecord = existing
          ? await tx.notification.update({
              where: { id: existing.id },
              data: { attemptCount: nextAttemptNumber },
              select: { id: true },
            })
          : await tx.notification.create({
              data: {
                organizationId: event.organizationId,
                branchId: event.branchId,
                notificationEventId: event.id,
                pushSubscriptionId: sub.id,
                recipientUserId: sub.userId,
                tokenId: event.tokenId,
                channel: "WEB_PUSH",
                title: formatted.title.slice(0, 160),
                body: formatted.body,
                targetUrl: formatted.targetUrl.slice(0, 300),
                status: "QUEUED",
                attemptCount: nextAttemptNumber,
              },
              select: { id: true },
            });

        tasks.push({
          notificationId: notifRecord.id,
          pushSubscriptionId: sub.id,
          attemptNumber: nextAttemptNumber,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          title: formatted.title,
          body: formatted.body,
          targetUrl: formatted.targetUrl,
          tag: formatted.tag,
        });
      }

      return tasks;
    },
    params.client,
  );

  // Zero eligible active subscribers -> event completed cleanly without retry waste.
  if (dispatchTasks.length === 0) {
    await withTenantDb(
      event.organizationId,
      async (tx) => {
        await tx.notificationEvent.update({
          where: { id: event.id },
          data: {
            status: "PROCESSED",
            processedAt: now,
            lockedUntil: null,
            lockedBy: null,
            lastError: null,
          },
        });
      },
      params.client,
    );

    return {
      finalStatus: "PROCESSED",
      deliveriesSucceeded: 0,
      subscriptionsExpired: 0,
    };
  }

  // Step 2: Execute Web Push HTTP calls in parallel outside any PostgreSQL lock.
  const results = await Promise.all(
    dispatchTasks.map(async (task) => {
      const result: PushSendResult = await transport.send({
        subscription: {
          endpoint: task.endpoint,
          p256dh: task.p256dh,
          auth: task.auth,
        },
        payload: {
          title: task.title,
          body: task.body,
          targetUrl: task.targetUrl,
          tag: task.tag,
          notificationId: task.notificationId,
        },
      });
      return { task, result };
    }),
  );

  // Step 3: Persist delivery logs, auto-cleanup 404/410 subscriptions, and schedule backoff/dead-letter.
  let deliveriesSucceeded = 0;
  let subscriptionsExpired = 0;
  let hasRetryableFailure = false;
  let hasPermanentInvalidFailure = false;
  let lastErrorSummary: string | null = null;

  await withTenantDb(
    event.organizationId,
    async (tx) => {
      for (const { task, result } of results) {
        if (result.ok) {
          deliveriesSucceeded += 1;
          await tx.notification.update({
            where: { id: task.notificationId },
            data: { status: "ACCEPTED_BY_PROVIDER" },
          });
          await tx.notificationDelivery.create({
            data: {
              organizationId: event.organizationId,
              notificationId: task.notificationId,
              attemptNumber: task.attemptNumber,
              status: "ACCEPTED_BY_PROVIDER",
              httpStatusCode: result.statusCode,
              durationMs: result.durationMs,
            },
          });
          await tx.pushSubscription.update({
            where: { id: task.pushSubscriptionId },
            data: { lastUsedAt: now },
          });
          continue;
        }

        lastErrorSummary =
          result.errorMessage ?? result.errorCode ?? `HTTP ${result.statusCode}`;

        if (result.permanentUnsubscribe) {
          subscriptionsExpired += 1;
          await tx.pushSubscription.update({
            where: { id: task.pushSubscriptionId },
            data: {
              isActive: false,
              revokedAt: now,
              revokedReason: "PROVIDER_EXPIRED",
            },
          });
          await tx.notification.update({
            where: { id: task.notificationId },
            data: { status: "FAILED" },
          });
        } else if (result.retryable) {
          hasRetryableFailure = true;
          const willDeadLetter = nextAttemptNumber >= event.maxAttempts;
          await tx.notification.update({
            where: { id: task.notificationId },
            data: { status: willDeadLetter ? "DEAD_LETTER" : "RETRYING" },
          });
        } else {
          hasPermanentInvalidFailure = true;
          await tx.notification.update({
            where: { id: task.notificationId },
            data: { status: "DEAD_LETTER" },
          });
        }

        await tx.notificationDelivery.create({
          data: {
            organizationId: event.organizationId,
            notificationId: task.notificationId,
            attemptNumber: task.attemptNumber,
            status: "FAILED",
            httpStatusCode: result.statusCode,
            errorCode: result.errorCode ?? null,
            errorMessage: result.errorMessage ?? null,
            durationMs: result.durationMs,
          },
        });
      }

      let nextEventStatus: "PROCESSED" | "RETRYING" | "DEAD_LETTER" = "PROCESSED";
      let nextAttemptAt: Date | null = null;
      let processedAt: Date | null = now;

      if (hasRetryableFailure) {
        if (nextAttemptNumber >= event.maxAttempts) {
          nextEventStatus = "DEAD_LETTER";
          processedAt = null;
        } else {
          nextEventStatus = "RETRYING";
          processedAt = null;
          const jitter = params.enableJitter ? 0.8 + Math.random() * 0.4 : 1.0;
          nextAttemptAt = new Date(
            now.getTime() + computeRetryBackoffMs(nextAttemptNumber, jitter),
          );
        }
      } else if (hasPermanentInvalidFailure && deliveriesSucceeded === 0) {
        nextEventStatus = "DEAD_LETTER";
        processedAt = null;
      }

      await tx.notificationEvent.update({
        where: { id: event.id },
        data: {
          status: nextEventStatus,
          attemptCount: nextAttemptNumber,
          nextAttemptAt,
          processedAt,
          lockedUntil: null,
          lockedBy: null,
          lastError: lastErrorSummary,
        },
      });
    },
    params.client,
  );

  const finalStatus = hasRetryableFailure
    ? nextAttemptNumber >= event.maxAttempts
      ? "DEAD_LETTER"
      : "RETRYING"
    : hasPermanentInvalidFailure && deliveriesSucceeded === 0
      ? "DEAD_LETTER"
      : "PROCESSED";

  return {
    finalStatus,
    deliveriesSucceeded,
    subscriptionsExpired,
  };
}

/**
 * Claims pending/retrying outbox events via PostgreSQL `FOR UPDATE SKIP LOCKED`
 * and dispatches Web Push deliveries cleanly across concurrent workers (`NT-01..06`).
 */
export async function runNotificationOutboxBatch(
  options: {
    batchSize?: number;
    workerId?: string;
    transport?: PushTransport;
    now?: Date;
    enableJitter?: boolean;
    client?: DbClient;
  } = {},
): Promise<OutboxBatchSummary> {
  const batchSize = Math.min(100, Math.max(1, options.batchSize ?? 20));
  const workerId = options.workerId ?? `worker-${crypto.randomUUID().slice(0, 8)}`;
  const transport = options.transport ?? defaultPushTransport;
  const now = options.now ?? new Date();
  const enableJitter = options.enableJitter ?? true;

  const claimed = await claimDueOutboxBatch({
    batchSize,
    workerId,
    now,
    client: options.client,
  });

  const summary: OutboxBatchSummary = {
    claimed: claimed.length,
    processed: 0,
    retrying: 0,
    deadLettered: 0,
    deliveriesSucceeded: 0,
    subscriptionsExpired: 0,
  };

  for (const event of claimed) {
    try {
      const outcome = await processSingleEvent({
        event,
        transport,
        now,
        enableJitter,
        client: options.client,
      });
      summary.deliveriesSucceeded += outcome.deliveriesSucceeded;
      summary.subscriptionsExpired += outcome.subscriptionsExpired;
      if (outcome.finalStatus === "PROCESSED") {
        summary.processed += 1;
      } else if (outcome.finalStatus === "RETRYING") {
        summary.retrying += 1;
      } else {
        summary.deadLettered += 1;
      }
    } catch (err) {
      logger.error(
        { err, eventId: event.id, organizationId: event.organizationId },
        "Unexpected error processing notification outbox event",
      );
      await withTenantDb(
        event.organizationId,
        async (tx) => {
          const nextAttempt = event.attemptCount + 1;
          const dead = nextAttempt >= event.maxAttempts;
          await tx.notificationEvent.update({
            where: { id: event.id },
            data: {
              status: dead ? "DEAD_LETTER" : "RETRYING",
              attemptCount: nextAttempt,
              nextAttemptAt: dead
                ? null
                : new Date(now.getTime() + computeRetryBackoffMs(nextAttempt)),
              lockedUntil: null,
              lockedBy: null,
              lastError: err instanceof Error ? err.message.slice(0, 300) : "Error",
            },
          });
        },
        options.client,
      );
      summary.retrying += 1;
    }
  }

  return summary;
}
