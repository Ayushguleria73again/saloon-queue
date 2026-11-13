import type { PublicTokenTrackingDto } from "@/features/public-intake/types";
import { NotFoundError } from "@/lib/errors";
import { maskMobileNumber } from "@/lib/phone";
import { withBranchDb, withSystemDb, type DbClient } from "@/server/db";
import { transitionBranchToken, type QueueMutatedEvent } from "./queue-service";
import { buildTokenStatusUrl, resolveEffectiveBranchSettings } from "./token-service";
import { computeBranchWaitSnapshot } from "./wait-time-service";

export interface PublicTokenScope {
  id: string;
  organizationId: string;
  branchId: string;
}

/**
 * Resolves minimal non-PII `(id, organizationId, branchId)` from an opaque `publicId`.
 */
export async function resolvePublicTokenScope(
  publicId: string,
  client?: DbClient,
): Promise<PublicTokenScope> {
  const cleanPublicId = publicId.trim();

  return withSystemDb(async (tx) => {
    const row = await tx.token.findUnique({
      where: { publicId: cleanPublicId },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
      },
    });

    if (!row) {
      throw new NotFoundError("Token was not found.");
    }

    return row;
  }, client);
}

/**
 * Returns sanitized live ticket tracking details for `/salon/[s]/[b]/token/[publicId]`
 * and `GET /api/public/tokens/[publicId]`. Raw mobile numbers and sibling customers are
 * never exposed (`TI-06`).
 */
export async function getPublicTokenTracking(params: {
  publicId: string;
  salonSlug?: string;
  branchSlug?: string;
  now?: Date;
  client?: DbClient;
}): Promise<PublicTokenTrackingDto> {
  const now = params.now ?? new Date();
  const scope = await resolvePublicTokenScope(params.publicId, params.client);

  return withBranchDb(
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
          businessDate: true,
          status: true,
          customerNameSnapshot: true,
          customerMobileSnapshot: true,
          notes: true,
          totalPriceInPaise: true,
          totalDurationMinutes: true,
          createdAt: true,
          calledAt: true,
          serviceStartedAt: true,
          completedAt: true,
          skippedAt: true,
          cancelledAt: true,
          noShowAt: true,
          organization: {
            select: { name: true, slug: true },
          },
          branch: {
            select: {
              id: true,
              name: true,
              slug: true,
              city: true,
              address: true,
              phone: true,
              timezone: true,
            },
          },
          tokenServices: {
            select: {
              serviceNameSnapshot: true,
              priceInPaiseSnapshot: true,
              durationMinutesSnapshot: true,
            },
          },
          requeuedToToken: {
            select: {
              publicId: true,
              tokenNumber: true,
            },
          },
          pushSubscriptions: {
            where: {
              subscriberType: "CUSTOMER",
              isActive: true,
            },
            take: 1,
            select: {
              id: true,
            },
          },
        },
      });

      if (!token) {
        throw new NotFoundError("Token was not found.");
      }

      if (
        (params.salonSlug &&
          token.organization.slug !== params.salonSlug.trim().toLowerCase()) ||
        (params.branchSlug &&
          token.branch.slug !== params.branchSlug.trim().toLowerCase())
      ) {
        throw new NotFoundError("Token was not found.");
      }

      const settings = await resolveEffectiveBranchSettings(
        tx,
        scope.organizationId,
        scope.branchId,
      );

      let queuePosition = 0;
      let peopleAhead = 0;
      let estimatedWaitMinutes = 0;

      if (
        token.status === "WAITING" ||
        token.status === "CALLED" ||
        token.status === "IN_SERVICE"
      ) {
        const waitSnapshot = await computeBranchWaitSnapshot(tx, {
          organizationId: scope.organizationId,
          branchId: scope.branchId,
          businessDate: token.businessDate,
          activeStationsCount: settings.activeStationsCount,
          bufferMinutes: settings.estimatedBufferMinutes,
          now,
        });
        const metrics = waitSnapshot.byTokenId.get(token.id);
        queuePosition = metrics?.queuePosition ?? 0;
        peopleAhead = metrics?.peopleAhead ?? 0;
        estimatedWaitMinutes = metrics?.estimatedWaitMinutes ?? 0;
      }

      return {
        publicId: token.publicId,
        tokenNumber: token.tokenNumber,
        status: token.status,
        customerName: token.customerNameSnapshot,
        maskedMobile: maskMobileNumber(token.customerMobileSnapshot),
        notes: token.notes,
        queuePosition,
        peopleAhead,
        estimatedWaitMinutes,
        totalPriceInPaise: token.totalPriceInPaise,
        totalDurationMinutes: token.totalDurationMinutes,
        canCustomerCancel: token.status === "WAITING" && settings.allowCustomerCancel,
        allowCustomerCancelSetting: settings.allowCustomerCancel,
        pushAlertsEnabled: token.pushSubscriptions.length > 0,
        organization: {
          name: token.organization.name,
          slug: token.organization.slug,
        },
        branch: {
          id: token.branch.id,
          name: token.branch.name,
          slug: token.branch.slug,
          city: token.branch.city,
          address: token.branch.address,
          phone: token.branch.phone,
          timezone: token.branch.timezone,
        },
        services: token.tokenServices.map((svc) => ({
          name: svc.serviceNameSnapshot,
          priceInPaise: svc.priceInPaiseSnapshot,
          durationMinutes: svc.durationMinutesSnapshot,
        })),
        requeuedTo: token.requeuedToToken
          ? {
              publicId: token.requeuedToToken.publicId,
              tokenNumber: token.requeuedToToken.tokenNumber,
              url: buildTokenStatusUrl(
                token.organization.slug,
                token.branch.slug,
                token.requeuedToToken.publicId,
              ),
            }
          : null,
        createdAt: token.createdAt.toISOString(),
        calledAt: token.calledAt ? token.calledAt.toISOString() : null,
        serviceStartedAt: token.serviceStartedAt
          ? token.serviceStartedAt.toISOString()
          : null,
        completedAt: token.completedAt ? token.completedAt.toISOString() : null,
        skippedAt: token.skippedAt ? token.skippedAt.toISOString() : null,
        cancelledAt: token.cancelledAt ? token.cancelledAt.toISOString() : null,
        noShowAt: token.noShowAt ? token.noShowAt.toISOString() : null,
      };
    },
    params.client,
  );
}

/**
 * Customer self-cancellation endpoint service (`IT-PUB-05`).
 * Permitted ONLY while `status === "WAITING"` and branch `allowCustomerCancel === true`.
 */
export async function cancelPublicToken(params: {
  publicId: string;
  reason?: string;
  ipAddressHash?: string;
  userAgent?: string;
  now?: Date;
  client?: DbClient;
  onQueueMutated?: (event: QueueMutatedEvent) => Promise<void> | void;
}): Promise<PublicTokenTrackingDto> {
  const now = params.now ?? new Date();
  const scope = await resolvePublicTokenScope(params.publicId, params.client);

  await transitionBranchToken({
    organizationId: scope.organizationId,
    branchId: scope.branchId,
    tokenId: scope.id,
    action: "CANCEL",
    actorType: "CUSTOMER",
    actorId: null,
    reason: params.reason,
    ipAddressHash: params.ipAddressHash,
    userAgent: params.userAgent,
    now,
    client: params.client,
    onQueueMutated: params.onQueueMutated,
  });

  return getPublicTokenTracking({
    publicId: params.publicId,
    now,
    client: params.client,
  });
}
