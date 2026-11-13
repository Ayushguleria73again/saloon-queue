import type { CreateCustomerPushSubscriptionInput } from "@/features/notifications/schemas";
import { getEnv } from "@/lib/env";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { withBranchDb, withSystemDb, type DbClient } from "@/server/db";
import { nudgeOutboxWorker } from "@/server/jobs/runner";
import { resolvePublicTokenScope } from "./token-tracking-service";
import { buildTokenStatusUrl } from "./token-service";

export interface CustomerPushSubscribeResult {
  subscribed: true;
  subscriptionId: string;
  vapidPublicKey: string;
}

export interface CustomerPushRevokeResult {
  subscribed: false;
  revokedCount: number;
}

const SUBSCRIBABLE_TOKEN_STATUSES = new Set(["WAITING", "CALLED", "IN_SERVICE"]);

/**
 * Registers or refreshes a token-scoped Web Push subscription after explicit customer opt-in.
 * Enqueues an idempotent confirmation push (`TOKEN_CONFIRMED_PUSH`) inside the same transaction.
 */
export async function upsertCustomerPushSubscription(params: {
  publicId: string;
  input: CreateCustomerPushSubscriptionInput;
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
}): Promise<CustomerPushSubscribeResult> {
  const now = params.now ?? new Date();
  const scope = await resolvePublicTokenScope(params.publicId, params.client);
  const endpoint = params.input.endpoint.trim();

  const subscriptionId = await withBranchDb(
    scope.organizationId,
    scope.branchId,
    async (tx) => {
      const token = await tx.token.findFirst({
        where: {
          id: scope.id,
          organizationId: scope.organizationId,
          branchId: scope.branchId,
        },
        select: {
          id: true,
          publicId: true,
          tokenNumber: true,
          status: true,
          organization: { select: { slug: true } },
          branch: { select: { name: true, slug: true } },
        },
      });

      if (!token) {
        throw new NotFoundError("Token was not found.");
      }

      if (!SUBSCRIBABLE_TOKEN_STATUSES.has(token.status)) {
        throw new ConflictError(
          "TOKEN_CLOSED",
          "Turn notifications can only be enabled while your token is active.",
        );
      }

      const existing = await tx.pushSubscription.findFirst({
        where: {
          organizationId: scope.organizationId,
          branchId: scope.branchId,
          subscriberType: "CUSTOMER",
          tokenId: token.id,
          endpoint,
        },
        select: { id: true },
      });

      const deviceLabel =
        params.input.deviceLabel?.trim() ||
        params.userAgent?.slice(0, 110) ||
        "Customer Device";

      const subRecord = existing
        ? await tx.pushSubscription.update({
            where: { id: existing.id },
            data: {
              p256dh: params.input.keys.p256dh,
              auth: params.input.keys.auth,
              deviceLabel,
              consentGivenAt: now,
              isActive: true,
              revokedAt: null,
              revokedReason: null,
            },
            select: { id: true },
          })
        : await tx.pushSubscription.create({
            data: {
              organizationId: scope.organizationId,
              branchId: scope.branchId,
              subscriberType: "CUSTOMER",
              tokenId: token.id,
              endpoint,
              p256dh: params.input.keys.p256dh,
              auth: params.input.keys.auth,
              deviceLabel,
              consentGivenAt: now,
              isActive: true,
            },
            select: { id: true },
          });

      await tx.notificationEvent.createMany({
        data: [
          {
            organizationId: scope.organizationId,
            branchId: scope.branchId,
            tokenId: token.id,
            eventType: "TOKEN_CONFIRMED_PUSH",
            idempotencyKey: `token:${token.id}:SUBSCRIPTION_CONFIRMED`,
            status: "PENDING",
            payload: {
              tokenId: token.id,
              publicId: token.publicId,
              tokenNumber: token.tokenNumber,
              branchId: scope.branchId,
              branchName: token.branch.name,
              targetUrl: buildTokenStatusUrl(
                token.organization.slug,
                token.branch.slug,
                token.publicId,
              ),
            },
          },
        ],
        skipDuplicates: true,
      });

      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          branchId: scope.branchId,
          actorType: "CUSTOMER",
          actorId: null,
          action: "CUSTOMER_PUSH_SUBSCRIBED",
          entityType: "PUSH_SUBSCRIPTION",
          entityId: subRecord.id,
          ipAddressHash: params.ipAddressHash ?? null,
          userAgent: params.userAgent?.slice(0, 256) ?? null,
          metadata: {
            tokenId: token.id,
            tokenNumber: token.tokenNumber,
          },
        },
      });

      return subRecord.id;
    },
    params.client,
  );

  try {
    nudgeOutboxWorker();
  } catch (error) {
    logger.warn(
      { err: error, tokenId: scope.id },
      "Failed to nudge outbox worker after customer push opt-in",
    );
  }

  return {
    subscribed: true,
    subscriptionId,
    vapidPublicKey: getEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  };
}

/**
 * Revokes active customer push subscriptions for a token (`CUSTOMER_OPT_OUT`).
 */
export async function revokeCustomerPushSubscription(params: {
  publicId: string;
  endpoint?: string;
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
}): Promise<CustomerPushRevokeResult> {
  const now = params.now ?? new Date();
  const scope = await resolvePublicTokenScope(params.publicId, params.client);
  const endpointFilter = params.endpoint?.trim();

  const revokedCount = await withBranchDb(
    scope.organizationId,
    scope.branchId,
    async (tx) => {
      const updated = await tx.pushSubscription.updateMany({
        where: {
          organizationId: scope.organizationId,
          branchId: scope.branchId,
          subscriberType: "CUSTOMER",
          tokenId: scope.id,
          isActive: true,
          ...(endpointFilter ? { endpoint: endpointFilter } : {}),
        },
        data: {
          isActive: false,
          revokedAt: now,
          revokedReason: "CUSTOMER_OPT_OUT",
        },
      });

      if (updated.count > 0) {
        await tx.auditLog.create({
          data: {
            organizationId: scope.organizationId,
            branchId: scope.branchId,
            actorType: "CUSTOMER",
            actorId: null,
            action: "CUSTOMER_PUSH_UNSUBSCRIBED",
            entityType: "TOKEN",
            entityId: scope.id,
            ipAddressHash: params.ipAddressHash ?? null,
            userAgent: params.userAgent?.slice(0, 256) ?? null,
            metadata: {
              revokedCount: updated.count,
            },
          },
        });
      }

      return updated.count;
    },
    params.client,
  );

  return {
    subscribed: false,
    revokedCount,
  };
}

/**
 * Records best-effort Service Worker receipt or notification click telemetry (`ACKNOWLEDGED`).
 * Always returns `{ ok: true }` to avoid leaking notification UUID existence across tenants.
 */
export async function acknowledgePublicNotification(params: {
  notificationId: string;
  event?: "DISPLAYED" | "CLICKED";
  now?: Date;
  client?: DbClient;
}): Promise<{ ok: true }> {
  const now = params.now ?? new Date();

  await withSystemDb(async (tx) => {
    await tx.notification.updateMany({
      where: {
        id: params.notificationId,
        status: { in: ["QUEUED", "ACCEPTED_BY_PROVIDER", "ACKNOWLEDGED"] },
      },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: now,
      },
    });
  }, params.client);

  return { ok: true };
}
