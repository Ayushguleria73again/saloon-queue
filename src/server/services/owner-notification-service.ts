import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  OwnerNotificationLogDto,
  OwnerPushSubscriptionDto,
} from "@/features/notifications/types";
import type { CreateOwnerPushSubscriptionInput } from "@/features/notifications/schemas";
import { getEnv } from "@/lib/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { AuthorizedTenantContext } from "@/server/auth";
import { withTenantDb, type DbClient } from "@/server/db";
import { runNotificationOutboxBatch } from "@/server/notifications/outbox-worker";
import type { PushTransport } from "@/server/notifications/web-push-adapter";

function parsePreferences(raw: Prisma.JsonValue | null) {
  const rec =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    newToken: rec.newToken !== false,
    longQueue: rec.longQueue !== false,
    testAlerts: rec.testAlerts !== false,
  };
}

function extractEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "push-endpoint";
  }
}

export async function listOwnerPushSubscriptions(
  ctx: AuthorizedTenantContext,
  client?: DbClient,
): Promise<{
  vapidPublicKey: string;
  subscriptions: OwnerPushSubscriptionDto[];
}> {
  const vapidPublicKey = getEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  const subscriptions = await withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const rows = await tx.pushSubscription.findMany({
        where: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          subscriberType: "OWNER_STAFF",
          isActive: true,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          branchId: true,
          endpoint: true,
          deviceLabel: true,
          isActive: true,
          preferences: true,
          lastUsedAt: true,
          createdAt: true,
          branch: {
            select: { name: true },
          },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        branchId: row.branchId,
        branchName: row.branch?.name ?? null,
        deviceLabel: row.deviceLabel,
        endpointHost: extractEndpointHost(row.endpoint),
        isActive: row.isActive,
        preferences: parsePreferences(row.preferences),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    client,
  );

  return { vapidPublicKey, subscriptions };
}

export async function upsertOwnerPushSubscription(
  ctx: AuthorizedTenantContext,
  input: CreateOwnerPushSubscriptionInput,
  meta: {
    ipAddressHash?: string;
    userAgent?: string;
    now?: Date;
    client?: DbClient;
  } = {},
): Promise<OwnerPushSubscriptionDto> {
  const now = meta.now ?? new Date();
  const branchId = input.branchId ?? null;

  if (branchId && !ctx.allBranches && !ctx.allowedBranchIds.has(branchId)) {
    throw new ForbiddenError(
      "BRANCH_ACCESS_DENIED",
      "You do not have access to subscribe to notifications for this branch.",
    );
  }

  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      if (branchId) {
        const branchExists = await tx.branch.findFirst({
          where: { id: branchId, organizationId: ctx.organizationId },
          select: { id: true },
        });
        if (!branchExists) {
          throw new NotFoundError("Selected branch was not found.");
        }
      }

      const prefs = {
        newToken: input.preferences?.newToken ?? true,
        longQueue: input.preferences?.longQueue ?? true,
        testAlerts: input.preferences?.testAlerts ?? true,
      };

      const existing = await tx.pushSubscription.findFirst({
        where: {
          userId: ctx.userId,
          endpoint: input.endpoint,
        },
        select: { id: true, organizationId: true },
      });

      const saved =
        existing && existing.organizationId === ctx.organizationId
          ? await tx.pushSubscription.update({
              where: { id: existing.id },
              data: {
                branchId,
                p256dh: input.keys.p256dh,
                auth: input.keys.auth,
                deviceLabel: input.deviceLabel ?? null,
                preferences: prefs,
                consentGivenAt: now,
                isActive: true,
                revokedAt: null,
                revokedReason: null,
              },
              select: {
                id: true,
                branchId: true,
                endpoint: true,
                deviceLabel: true,
                isActive: true,
                preferences: true,
                lastUsedAt: true,
                createdAt: true,
                branch: { select: { name: true } },
              },
            })
          : await tx.pushSubscription.create({
              data: {
                organizationId: ctx.organizationId,
                branchId,
                subscriberType: "OWNER_STAFF",
                userId: ctx.userId,
                endpoint: input.endpoint,
                p256dh: input.keys.p256dh,
                auth: input.keys.auth,
                deviceLabel: input.deviceLabel ?? null,
                preferences: prefs,
                consentGivenAt: now,
                isActive: true,
              },
              select: {
                id: true,
                branchId: true,
                endpoint: true,
                deviceLabel: true,
                isActive: true,
                preferences: true,
                lastUsedAt: true,
                createdAt: true,
                branch: { select: { name: true } },
              },
            });

      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          branchId,
          actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
          actorId: ctx.userId,
          action: "PUSH_SUBSCRIPTION_SAVED",
          entityType: "PushSubscription",
          entityId: saved.id,
          ipAddressHash: meta.ipAddressHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
        },
      });

      return {
        id: saved.id,
        branchId: saved.branchId,
        branchName: saved.branch?.name ?? null,
        deviceLabel: saved.deviceLabel,
        endpointHost: extractEndpointHost(saved.endpoint),
        isActive: saved.isActive,
        preferences: parsePreferences(saved.preferences),
        lastUsedAt: saved.lastUsedAt ? saved.lastUsedAt.toISOString() : null,
        createdAt: saved.createdAt.toISOString(),
      };
    },
    meta.client,
  );
}

export async function revokeOwnerPushSubscription(
  ctx: AuthorizedTenantContext,
  input: { id?: string; endpoint?: string },
  meta: { now?: Date; client?: DbClient } = {},
): Promise<{ revokedCount: number }> {
  const now = meta.now ?? new Date();

  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const updated = await tx.pushSubscription.updateMany({
        where: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          subscriberType: "OWNER_STAFF",
          isActive: true,
          ...(input.id ? { id: input.id } : {}),
          ...(input.endpoint ? { endpoint: input.endpoint } : {}),
        },
        data: {
          isActive: false,
          revokedAt: now,
          revokedReason: "USER_UNSUBSCRIBED",
        },
      });

      if (updated.count === 0) {
        throw new NotFoundError("Active push subscription was not found.");
      }

      return { revokedCount: updated.count };
    },
    meta.client,
  );
}

export async function triggerOwnerTestPush(
  ctx: AuthorizedTenantContext,
  options: {
    subscriptionId?: string;
    transport?: PushTransport;
    now?: Date;
    client?: DbClient;
  } = {},
) {
  const now = options.now ?? new Date();

  const eventId = await withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const activeSub = await tx.pushSubscription.findFirst({
        where: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          subscriberType: "OWNER_STAFF",
          isActive: true,
          ...(options.subscriptionId ? { id: options.subscriptionId } : {}),
        },
        select: { id: true, branchId: true },
      });

      if (!activeSub) {
        throw new ValidationError(
          "Please enable browser push notifications on a device before sending a test.",
        );
      }

      const event = await tx.notificationEvent.create({
        data: {
          organizationId: ctx.organizationId,
          branchId: activeSub.branchId,
          eventType: "OWNER_TEST_PUSH",
          idempotencyKey: `owner-test:${ctx.userId}:${crypto.randomUUID()}`,
          status: "PENDING",
          payload: {
            recipientUserId: ctx.userId,
            subscriptionId: options.subscriptionId ?? null,
            targetUrl: "/owner/settings/notifications",
          },
        },
        select: { id: true },
      });

      return event.id;
    },
    options.client,
  );

  const summary = await runNotificationOutboxBatch({
    batchSize: 10,
    transport: options.transport,
    now,
    client: options.client,
  });

  return { eventId, summary };
}

export async function listOwnerNotifications(
  ctx: AuthorizedTenantContext,
  options: { limit?: number; client?: DbClient } = {},
): Promise<OwnerNotificationLogDto[]> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 25));

  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const rows = await tx.notification.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(ctx.roleSlug === "OWNER"
            ? {}
            : {
                OR: [
                  { recipientUserId: ctx.userId },
                  ...(ctx.allBranches
                    ? [{ branchId: { not: null } }]
                    : [{ branchId: { in: [...ctx.allowedBranchIds] } }]),
                ],
              }),
        },
        orderBy: [{ createdAt: "desc" }],
        take: limit,
        select: {
          id: true,
          notificationEventId: true,
          title: true,
          body: true,
          targetUrl: true,
          status: true,
          attemptCount: true,
          acknowledgedAt: true,
          createdAt: true,
          notificationEvent: {
            select: {
              eventType: true,
              status: true,
              lastError: true,
            },
          },
          deliveries: {
            orderBy: [{ attemptNumber: "desc" }],
            take: 1,
            select: {
              httpStatusCode: true,
              errorCode: true,
              errorMessage: true,
              durationMs: true,
              attemptedAt: true,
            },
          },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        notificationEventId: row.notificationEventId,
        eventType: row.notificationEvent.eventType,
        eventStatus: row.notificationEvent.status,
        attemptCount: row.attemptCount,
        title: row.title,
        body: row.body,
        targetUrl: row.targetUrl,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
        lastError: row.notificationEvent.lastError,
        latestDelivery: row.deliveries[0]
          ? {
              httpStatusCode: row.deliveries[0].httpStatusCode,
              errorCode: row.deliveries[0].errorCode,
              errorMessage: row.deliveries[0].errorMessage,
              durationMs: row.deliveries[0].durationMs,
              attemptedAt: row.deliveries[0].attemptedAt.toISOString(),
            }
          : null,
      }));
    },
    options.client,
  );
}

export async function retryOwnerNotification(
  ctx: AuthorizedTenantContext,
  notificationId: string,
  options: { transport?: PushTransport; now?: Date; client?: DbClient } = {},
) {
  const now = options.now ?? new Date();

  const eventId = await withTenantDb(
    ctx.organizationId,
    async (tx) => {
      const notif = await tx.notification.findFirst({
        where: {
          id: notificationId,
          organizationId: ctx.organizationId,
        },
        select: {
          id: true,
          branchId: true,
          recipientUserId: true,
          notificationEventId: true,
        },
      });

      if (!notif) {
        throw new NotFoundError("Notification record was not found.");
      }

      if (
        notif.branchId &&
        !ctx.allBranches &&
        !ctx.allowedBranchIds.has(notif.branchId)
      ) {
        throw new ForbiddenError("BRANCH_ACCESS_DENIED");
      }

      await tx.notificationEvent.update({
        where: { id: notif.notificationEventId },
        data: {
          status: "PENDING",
          attemptCount: 0,
          nextAttemptAt: now,
          lockedUntil: null,
          lockedBy: null,
          lastError: null,
        },
      });

      return notif.notificationEventId;
    },
    options.client,
  );

  const summary = await runNotificationOutboxBatch({
    batchSize: 10,
    transport: options.transport,
    now,
    client: options.client,
  });

  return { eventId, summary };
}
