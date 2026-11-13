import crypto from "node:crypto";
import type { ActorType, Prisma, TokenSource, TokenStatus } from "@prisma/client";
import {
  getBranchLocalTimeInfo,
  getBusinessDateForTimezone,
  isWithinBusinessHours,
} from "@/lib/date";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { maskMobileNumber, normalizeIndianMobile } from "@/lib/phone";
import { withBranchDb, withSystemDb, type DbClient } from "@/server/db";
import { nudgeOutboxWorker } from "@/server/jobs/runner";
import { getRealtimeHub } from "@/server/realtime";
import { validateBranchServiceSelection } from "./branch-public-service";
import { computeBranchWaitSnapshot } from "./wait-time-service";

export interface PublicBranchIdentity {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  branch: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    qrToken: string;
    isActive: boolean;
  };
}

export interface CreatedTokenDto {
  publicId: string;
  tokenNumber: string;
  status: TokenStatus;
  queuePosition: number;
  peopleAhead: number;
  estimatedWaitMinutes: number;
  createdAt: string;
}

export interface TokenCommittedEvent {
  organizationId: string;
  branchId: string;
  tokenId: string;
  notificationEventId: string;
  token: CreatedTokenDto;
  redirectUrl: string;
  source: TokenSource;
}

export interface CreateTokenResult {
  isIdempotentReplay: boolean;
  token: CreatedTokenDto;
  redirectUrl: string;
}

export interface IssueBranchTokenParams {
  organizationId: string;
  organizationSlug: string;
  branchId: string;
  branchName: string;
  branchSlug: string;
  branchTimezone: string;
  branchQrToken: string;
  fullName: string;
  mobileNumber: string;
  serviceIds: ReadonlyArray<string>;
  notes?: string | null;
  idempotencyKey?: string | null;
  qrToken?: string | null;
  source?: TokenSource;
  actorType?: ActorType;
  actorId?: string | null;
  enforcePublicIntakeRules?: boolean;
  ipAddressHash?: string | null;
  userAgent?: string | null;
  now?: Date;
  client?: DbClient;
  onTokenCommitted?: (event: TokenCommittedEvent) => Promise<void> | void;
}

export interface CreatePublicTokenParams {
  salonSlug: string;
  branchSlug: string;
  fullName: string;
  mobileNumber: string;
  serviceIds: ReadonlyArray<string>;
  notes?: string | null;
  idempotencyKey?: string | null;
  qrToken?: string | null;
  ipAddressHash?: string | null;
  userAgent?: string | null;
  now?: Date;
  client?: DbClient;
  resolvedIdentity?: PublicBranchIdentity;
  onTokenCommitted?: (event: TokenCommittedEvent) => Promise<void> | void;
}

export function formatTokenNumber(prefix: string, sequenceNumber: number): string {
  const cleanPrefix = prefix.trim() || "A";
  return `${cleanPrefix}${String(sequenceNumber).padStart(3, "0")}`;
}

export function generateOpaqueTokenPublicId(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function buildTokenStatusUrl(
  salonSlug: string,
  branchSlug: string,
  publicId: string,
): string {
  return `/salon/${salonSlug}/${branchSlug}/token/${publicId}`;
}

export interface EffectiveBranchSettings {
  tokenPrefix: string;
  activeStationsCount: number;
  allowDuplicateActiveTokens: boolean;
  allowCustomerCancel: boolean;
  enforceBusinessHours: boolean;
  isAcceptingTokens: boolean;
  queuePausedReason: string | null;
  requireValidQrToken: boolean;
  dayResetTime: string;
  estimatedBufferMinutes: number;
  customerPushThresholds: number[];
}

/**
 * Resolves branch-specific `SalonSettings` with fallback to organization defaults.
 */
export async function resolveEffectiveBranchSettings(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
): Promise<EffectiveBranchSettings> {
  const settingsRows = await tx.salonSettings.findMany({
    where: {
      organizationId,
      OR: [{ branchId }, { branchId: null }],
    },
    select: {
      branchId: true,
      tokenPrefix: true,
      activeStationsCount: true,
      allowDuplicateActiveTokens: true,
      allowCustomerCancel: true,
      enforceBusinessHours: true,
      isAcceptingTokens: true,
      queuePausedReason: true,
      requireValidQrToken: true,
      dayResetTime: true,
      estimatedBufferMinutes: true,
      customerPushThresholds: true,
    },
  });

  const resolved = settingsRows.find((s) => s.branchId === branchId) ??
    settingsRows.find((s) => s.branchId === null) ?? {
      tokenPrefix: "A",
      activeStationsCount: 1,
      allowDuplicateActiveTokens: false,
      allowCustomerCancel: true,
      enforceBusinessHours: true,
      isAcceptingTokens: true,
      queuePausedReason: null,
      requireValidQrToken: false,
      dayResetTime: "00:00",
      estimatedBufferMinutes: 0,
      customerPushThresholds: [3, 1],
    };

  return {
    tokenPrefix: resolved.tokenPrefix,
    activeStationsCount: resolved.activeStationsCount,
    allowDuplicateActiveTokens: resolved.allowDuplicateActiveTokens,
    allowCustomerCancel: resolved.allowCustomerCancel,
    enforceBusinessHours: resolved.enforceBusinessHours,
    isAcceptingTokens: resolved.isAcceptingTokens,
    queuePausedReason: resolved.queuePausedReason,
    requireValidQrToken: resolved.requireValidQrToken,
    dayResetTime: resolved.dayResetTime,
    estimatedBufferMinutes: resolved.estimatedBufferMinutes,
    customerPushThresholds: resolved.customerPushThresholds,
  };
}

/**
 * Atomically increments and returns the next daily `(branchId, businessDate, prefix)`
 * FIFO queue sequence number and formatted token number.
 */
export async function allocateNextQueueTokenNumber(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    branchId: string;
    businessDate: Date;
    tokenPrefix: string;
  },
): Promise<{ sequenceNumber: number; tokenNumber: string }> {
  const prefix = (params.tokenPrefix.trim() || "A").slice(0, 8);
  const businessDateIso = params.businessDate.toISOString().slice(0, 10);
  const counterRows = await tx.$queryRaw<Array<{ last_number: number }>>`
    INSERT INTO "queue_counters" (
      "id",
      "organization_id",
      "branch_id",
      "business_date",
      "prefix",
      "last_number",
      "updated_at"
    )
    VALUES (
      ${crypto.randomUUID()}::uuid,
      ${params.organizationId}::uuid,
      ${params.branchId}::uuid,
      ${businessDateIso}::date,
      ${prefix},
      1,
      NOW()
    )
    ON CONFLICT ("branch_id", "business_date", "prefix")
    DO UPDATE SET
      "last_number" = "queue_counters"."last_number" + 1,
      "updated_at" = NOW()
    RETURNING "last_number"
  `;

  const sequenceNumber = Number(counterRows[0]?.last_number ?? 0);
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new Error("Failed to allocate atomic queue sequence number.");
  }

  return {
    sequenceNumber,
    tokenNumber: formatTokenNumber(prefix, sequenceNumber),
  };
}

/**
 * Resolves organization and branch routing identity via public slugs.
 * Uses bounded system lookup without returning any customer or tenant operational PII.
 */
export async function resolvePublicBranchIdentity(
  salonSlug: string,
  branchSlug: string,
  client?: DbClient,
): Promise<PublicBranchIdentity> {
  const normalizedSalonSlug = salonSlug.trim().toLowerCase();
  const normalizedBranchSlug = branchSlug.trim().toLowerCase();

  return withSystemDb(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { slug: normalizedSalonSlug },
      select: { id: true, name: true, slug: true, status: true },
    });

    if (!organization) {
      throw new NotFoundError("Salon was not found.");
    }

    const branch = await tx.branch.findUnique({
      where: {
        organizationId_slug: {
          organizationId: organization.id,
          slug: normalizedBranchSlug,
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        qrToken: true,
        isActive: true,
      },
    });

    if (!branch) {
      throw new NotFoundError("Branch was not found.");
    }

    return { organization, branch };
  }, client);
}

/**
 * Public QR intake entry point (`source = "QR"`).
 */
export async function createPublicToken(
  params: CreatePublicTokenParams,
): Promise<CreateTokenResult> {
  const identity =
    params.resolvedIdentity ??
    (await resolvePublicBranchIdentity(
      params.salonSlug,
      params.branchSlug,
      params.client,
    ));

  if (identity.organization.status !== "ACTIVE") {
    throw new ForbiddenError("TENANT_SUSPENDED", "This salon is currently unavailable.");
  }

  if (!identity.branch.isActive) {
    throw new ForbiddenError(
      "BRANCH_NOT_ACCEPTING",
      "This branch is currently inactive.",
    );
  }

  return issueBranchToken({
    organizationId: identity.organization.id,
    organizationSlug: identity.organization.slug,
    branchId: identity.branch.id,
    branchName: identity.branch.name,
    branchSlug: identity.branch.slug,
    branchTimezone: identity.branch.timezone,
    branchQrToken: identity.branch.qrToken,
    fullName: params.fullName,
    mobileNumber: params.mobileNumber,
    serviceIds: params.serviceIds,
    notes: params.notes,
    idempotencyKey: params.idempotencyKey,
    qrToken: params.qrToken,
    source: "QR",
    actorType: "CUSTOMER",
    actorId: null,
    enforcePublicIntakeRules: true,
    ipAddressHash: params.ipAddressHash,
    userAgent: params.userAgent,
    now: params.now,
    client: params.client,
    onTokenCommitted: params.onTokenCommitted,
  });
}

/**
 * Core ACID transactional token generation engine shared across public QR submissions (`QR`)
 * and staff walk-in token creation (`WALK_IN`).
 */
export async function issueBranchToken(
  params: IssueBranchTokenParams,
): Promise<CreateTokenResult> {
  const now = params.now ?? new Date();
  const normalizedMobile = normalizeIndianMobile(params.mobileNumber);
  const trimmedName = params.fullName.trim();
  const trimmedNotes = params.notes?.trim() ? params.notes.trim() : null;
  const normalizedIdempotencyKey = params.idempotencyKey?.trim()
    ? params.idempotencyKey.trim()
    : null;
  const source: TokenSource = params.source ?? "QR";
  const actorType: ActorType = params.actorType ?? "CUSTOMER";
  const enforcePublicIntakeRules = params.enforcePublicIntakeRules ?? true;

  if (trimmedName.length < 2) {
    throw new ValidationError("Full name must be at least 2 characters.");
  }

  const txOutcome = await withBranchDb(
    params.organizationId,
    params.branchId,
    async (tx) => {
      // 1. Serialize concurrent requests per (branch, mobile) before checking idempotency
      //    or active duplicates so rapid double-taps deterministically replay instead of colliding.
      const advisoryLockKey = `${params.branchId}:${normalizedMobile}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryLockKey}::text)::bigint)`;

      // 2. Load branch settings (branch override falls back to organization default).
      const settings = await resolveEffectiveBranchSettings(
        tx,
        params.organizationId,
        params.branchId,
      );

      const businessDate = getBusinessDateForTimezone(
        params.branchTimezone,
        now,
        settings.dayResetTime,
      );

      // 3. Idempotent replay check before mutating or rejecting on duplicate active token.
      if (normalizedIdempotencyKey) {
        const existingToken = await tx.token.findUnique({
          where: {
            branchId_idempotencyKey: {
              branchId: params.branchId,
              idempotencyKey: normalizedIdempotencyKey,
            },
          },
          select: {
            id: true,
            publicId: true,
            tokenNumber: true,
            status: true,
            businessDate: true,
            customerMobileSnapshot: true,
            createdAt: true,
          },
        });

        if (existingToken) {
          if (existingToken.customerMobileSnapshot !== normalizedMobile) {
            throw new ValidationError(
              "Idempotency key does not match the customer request.",
            );
          }

          const replayWait = await computeBranchWaitSnapshot(tx, {
            organizationId: params.organizationId,
            branchId: params.branchId,
            businessDate: existingToken.businessDate,
            activeStationsCount: settings.activeStationsCount,
            bufferMinutes: settings.estimatedBufferMinutes,
            now,
          });
          const metrics = replayWait.byTokenId.get(existingToken.id);

          return {
            isIdempotentReplay: true,
            notificationEventId: null,
            tokenId: existingToken.id,
            token: {
              publicId: existingToken.publicId,
              tokenNumber: existingToken.tokenNumber,
              status: existingToken.status,
              queuePosition: metrics?.queuePosition ?? 0,
              peopleAhead: metrics?.peopleAhead ?? 0,
              estimatedWaitMinutes: metrics?.estimatedWaitMinutes ?? 0,
              createdAt: existingToken.createdAt.toISOString(),
            },
            redirectUrl: buildTokenStatusUrl(
              params.organizationSlug,
              params.branchSlug,
              existingToken.publicId,
            ),
          };
        }
      }

      // 4. Enforce public intake policies (QR validation, pause state, weekly hours).
      if (enforcePublicIntakeRules) {
        if (
          settings.requireValidQrToken &&
          params.qrToken?.trim() !== params.branchQrToken
        ) {
          throw new ForbiddenError(
            "QR_TOKEN_INVALID",
            "A valid branch QR code is required to join the queue.",
          );
        }

        if (!settings.isAcceptingTokens) {
          throw new ForbiddenError(
            "BRANCH_NOT_ACCEPTING",
            settings.queuePausedReason ??
              "This branch is currently paused and not accepting new tokens.",
          );
        }

        if (settings.enforceBusinessHours) {
          const localTime = getBranchLocalTimeInfo(params.branchTimezone, now);
          const todayHours = await tx.businessHours.findUnique({
            where: {
              branchId_dayOfWeek: {
                branchId: params.branchId,
                dayOfWeek: localTime.dayOfWeek,
              },
            },
            select: {
              isOpen: true,
              openTime: true,
              closeTime: true,
              breakStartTime: true,
              breakEndTime: true,
            },
          });

          if (!isWithinBusinessHours(todayHours ?? undefined, localTime.hhMm)) {
            throw new ForbiddenError(
              "BRANCH_NOT_ACCEPTING",
              "This branch is currently closed or on break.",
            );
          }
        }
      }

      // 5. Validate requested services belong cleanly to this branch (TI-04).
      const resolvedServices = await validateBranchServiceSelection(
        tx,
        params.organizationId,
        params.branchId,
        params.serviceIds,
      );

      let totalPriceInPaise = 0;
      let totalDurationMinutes = 0;
      for (const service of resolvedServices) {
        totalPriceInPaise += service.priceInPaiseSnapshot;
        totalDurationMinutes += service.durationMinutesSnapshot;
      }

      // 6. Enforce duplicate active token guard without exposing existing token PII.
      if (!settings.allowDuplicateActiveTokens) {
        const existingCustomer = await tx.customer.findUnique({
          where: {
            branchId_mobileNumber: {
              branchId: params.branchId,
              mobileNumber: normalizedMobile,
            },
          },
          select: { id: true },
        });

        if (existingCustomer) {
          const activeToken = await tx.token.findFirst({
            where: {
              organizationId: params.organizationId,
              branchId: params.branchId,
              customerId: existingCustomer.id,
              status: { in: ["WAITING", "CALLED", "IN_SERVICE"] },
            },
            select: { id: true },
          });

          if (activeToken) {
            throw new ConflictError(
              "ACTIVE_TOKEN_EXISTS",
              "An active token already exists for this mobile number at this branch.",
            );
          }
        }
      }

      // 7. Upsert branch-scoped customer record.
      const customer = await tx.customer.upsert({
        where: {
          branchId_mobileNumber: {
            branchId: params.branchId,
            mobileNumber: normalizedMobile,
          },
        },
        update: {
          name: trimmedName,
        },
        create: {
          organizationId: params.organizationId,
          branchId: params.branchId,
          name: trimmedName,
          mobileNumber: normalizedMobile,
        },
        select: { id: true },
      });

      // 8. Atomically allocate next sequence number for (branch, businessDate, prefix).
      const { sequenceNumber, tokenNumber } = await allocateNextQueueTokenNumber(tx, {
        organizationId: params.organizationId,
        branchId: params.branchId,
        businessDate,
        tokenPrefix: settings.tokenPrefix,
      });
      const publicId = generateOpaqueTokenPublicId();
      const redirectUrl = buildTokenStatusUrl(
        params.organizationSlug,
        params.branchSlug,
        publicId,
      );

      // 9. Create Token + TokenService historical snapshots.
      const createdToken = await tx.token.create({
        data: {
          publicId,
          organizationId: params.organizationId,
          branchId: params.branchId,
          customerId: customer.id,
          businessDate,
          sequenceNumber,
          tokenNumber,
          source,
          customerNameSnapshot: trimmedName,
          customerMobileSnapshot: normalizedMobile,
          notes: trimmedNotes,
          status: "WAITING",
          totalPriceInPaise,
          totalDurationMinutes,
          idempotencyKey: normalizedIdempotencyKey,
        },
        select: {
          id: true,
          publicId: true,
          tokenNumber: true,
          status: true,
          createdAt: true,
        },
      });

      await tx.tokenService.createMany({
        data: resolvedServices.map((service) => ({
          organizationId: params.organizationId,
          tokenId: createdToken.id,
          serviceId: service.serviceId,
          serviceNameSnapshot: service.serviceNameSnapshot,
          priceInPaiseSnapshot: service.priceInPaiseSnapshot,
          durationMinutesSnapshot: service.durationMinutesSnapshot,
        })),
      });

      const maskedMobile = maskMobileNumber(normalizedMobile);

      // 10. Write transactional NotificationEvent outbox row + AuditLog atomically.
      const notificationEvent = await tx.notificationEvent.create({
        data: {
          organizationId: params.organizationId,
          branchId: params.branchId,
          tokenId: createdToken.id,
          eventType: "NEW_TOKEN_OWNER_ALERT",
          idempotencyKey: `token:${createdToken.id}:NEW_TOKEN_OWNER_ALERT`,
          status: "PENDING",
          payload: {
            tokenId: createdToken.id,
            publicId: createdToken.publicId,
            tokenNumber: createdToken.tokenNumber,
            branchId: params.branchId,
            branchName: params.branchName,
            customerName: trimmedName,
            maskedMobile,
            source,
            serviceNames: resolvedServices.map((s) => s.serviceNameSnapshot),
            totalPriceInPaise,
            totalDurationMinutes,
            targetUrl: `/owner/queue?branchId=${params.branchId}`,
          },
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          organizationId: params.organizationId,
          branchId: params.branchId,
          actorType,
          actorId: params.actorId ?? null,
          action: "TOKEN_CREATED",
          entityType: "TOKEN",
          entityId: createdToken.id,
          ipAddressHash: params.ipAddressHash ?? null,
          userAgent: params.userAgent ? params.userAgent.slice(0, 256) : null,
          metadata: {
            tokenNumber: createdToken.tokenNumber,
            source,
            serviceCount: resolvedServices.length,
            totalPriceInPaise,
            totalDurationMinutes,
            maskedMobile,
          },
        },
      });

      // 11. Compute live queue position & wait time estimate for the new token.
      const waitSnapshot = await computeBranchWaitSnapshot(tx, {
        organizationId: params.organizationId,
        branchId: params.branchId,
        businessDate,
        activeStationsCount: settings.activeStationsCount,
        bufferMinutes: settings.estimatedBufferMinutes,
        now,
      });

      const tokenMetrics = waitSnapshot.byTokenId.get(createdToken.id);

      return {
        isIdempotentReplay: false,
        notificationEventId: notificationEvent.id,
        tokenId: createdToken.id,
        token: {
          publicId: createdToken.publicId,
          tokenNumber: createdToken.tokenNumber,
          status: createdToken.status,
          queuePosition: tokenMetrics?.queuePosition ?? 1,
          peopleAhead: tokenMetrics?.peopleAhead ?? 0,
          estimatedWaitMinutes: tokenMetrics?.estimatedWaitMinutes ?? 0,
          createdAt: createdToken.createdAt.toISOString(),
        },
        redirectUrl,
      };
    },
    params.client,
  );

  // 12. Post-commit non-blocking notification / realtime hooks.
  if (!txOutcome.isIdempotentReplay && txOutcome.notificationEventId) {
    nudgeOutboxWorker();
    getRealtimeHub().publishQueueMutation({
      organizationId: params.organizationId,
      branchId: params.branchId,
      tokenId: txOutcome.tokenId,
      tokenNumber: txOutcome.token.tokenNumber,
      action: "TOKEN_CREATED",
      timestamp: new Date().toISOString(),
    });
    if (params.onTokenCommitted) {
      try {
        await params.onTokenCommitted({
          organizationId: params.organizationId,
          branchId: params.branchId,
          tokenId: txOutcome.tokenId,
          notificationEventId: txOutcome.notificationEventId,
          token: txOutcome.token,
          redirectUrl: txOutcome.redirectUrl,
          source,
        });
      } catch (hookError) {
        logger.warn(
          {
            err: hookError,
            organizationId: params.organizationId,
            branchId: params.branchId,
            tokenId: txOutcome.tokenId,
            notificationEventId: txOutcome.notificationEventId,
          },
          "Post-commit token hook failed; committed token preserved",
        );
      }
    }
  }

  return {
    isIdempotentReplay: txOutcome.isIdempotentReplay,
    token: txOutcome.token,
    redirectUrl: txOutcome.redirectUrl,
  };
}
