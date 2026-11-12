import type { Prisma } from "@prisma/client";
import type { PublicServiceOption } from "@/features/public-intake/types";
import {
  getBranchLocalTimeInfo,
  getBusinessDateForTimezone,
  isWithinBusinessHours,
} from "@/lib/date";
import { NotFoundError, ServiceUnavailableError } from "@/lib/errors";
import { withBranchDb, withSystemDb, type DbClient } from "@/server/db";
import { getCachedAvailableBranchServices } from "./catalog-service";
import { computeBranchWaitSnapshot } from "./wait-time-service";

export type IntakeBlockedReason =
  | "TENANT_SUSPENDED"
  | "BRANCH_INACTIVE"
  | "QR_TOKEN_INVALID"
  | "QUEUE_PAUSED"
  | "BRANCH_CLOSED";

export interface PublicBusinessHourDto {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
}

export type PublicServiceDto = PublicServiceOption;

export interface PublicBranchSnapshot {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  branch: {
    id: string;
    name: string;
    slug: string;
    city: string | null;
    address: string | null;
    phone: string | null;
    timezone: string;
  };
  intake: {
    canAcceptTokens: boolean;
    qrValid: boolean;
    reason: IntakeBlockedReason | null;
    pausedReason: string | null;
    waitingCount: number;
    estimatedNewJoinWaitMinutes: number;
  };
  services: PublicServiceDto[];
  businessHours: PublicBusinessHourDto[];
}

export async function getPublicBranchSnapshot(params: {
  salonSlug: string;
  branchSlug: string;
  qrToken?: string | null;
  now?: Date;
  client?: DbClient;
}): Promise<PublicBranchSnapshot> {
  const now = params.now ?? new Date();
  const normalizedSalonSlug = params.salonSlug.trim().toLowerCase();
  const normalizedBranchSlug = params.branchSlug.trim().toLowerCase();

  const resolved = await withSystemDb(async (tx) => {
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
        city: true,
        address: true,
        phone: true,
        timezone: true,
        qrToken: true,
        isActive: true,
      },
    });

    if (!branch) {
      throw new NotFoundError("Branch was not found.");
    }

    return { organization, branch };
  }, params.client);

  const { organization, branch } = resolved;

  if (organization.status !== "ACTIVE") {
    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        city: branch.city,
        address: branch.address,
        phone: branch.phone,
        timezone: branch.timezone,
      },
      intake: {
        canAcceptTokens: false,
        qrValid: false,
        reason: "TENANT_SUSPENDED",
        pausedReason: null,
        waitingCount: 0,
        estimatedNewJoinWaitMinutes: 0,
      },
      services: [],
      businessHours: [],
    };
  }

  if (!branch.isActive) {
    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        city: branch.city,
        address: branch.address,
        phone: branch.phone,
        timezone: branch.timezone,
      },
      intake: {
        canAcceptTokens: false,
        qrValid: false,
        reason: "BRANCH_INACTIVE",
        pausedReason: null,
        waitingCount: 0,
        estimatedNewJoinWaitMinutes: 0,
      },
      services: [],
      businessHours: [],
    };
  }

  const branchOperational = await withBranchDb(
    organization.id,
    branch.id,
    async (tx) => {
      const [settingsRows, businessHours] = await Promise.all([
        tx.salonSettings.findMany({
          where: {
            organizationId: organization.id,
            OR: [{ branchId: branch.id }, { branchId: null }],
          },
          select: {
            branchId: true,
            activeStationsCount: true,
            enforceBusinessHours: true,
            isAcceptingTokens: true,
            queuePausedReason: true,
            requireValidQrToken: true,
            dayResetTime: true,
            estimatedBufferMinutes: true,
          },
        }),
        tx.businessHours.findMany({
          where: { organizationId: organization.id, branchId: branch.id },
          orderBy: { dayOfWeek: "asc" },
          select: {
            dayOfWeek: true,
            isOpen: true,
            openTime: true,
            closeTime: true,
            breakStartTime: true,
            breakEndTime: true,
          },
        }),
      ]);

      const settings = settingsRows.find((s) => s.branchId === branch.id) ??
        settingsRows.find((s) => s.branchId === null) ?? {
          activeStationsCount: 1,
          enforceBusinessHours: true,
          isAcceptingTokens: true,
          queuePausedReason: null,
          requireValidQrToken: false,
          dayResetTime: "00:00",
          estimatedBufferMinutes: 0,
        };

      const businessDate = getBusinessDateForTimezone(
        branch.timezone,
        now,
        settings.dayResetTime,
      );

      const waitProjection = await computeBranchWaitSnapshot(tx, {
        organizationId: organization.id,
        branchId: branch.id,
        businessDate,
        activeStationsCount: settings.activeStationsCount,
        bufferMinutes: settings.estimatedBufferMinutes,
        now,
      });

      return { settings, businessHours, waitProjection };
    },
    params.client,
  );

  const cachedServices = await getCachedAvailableBranchServices(
    organization.id,
    branch.id,
    params.client,
  );

  const { settings, businessHours, waitProjection } = branchOperational;
  const localTime = getBranchLocalTimeInfo(branch.timezone, now);
  const todayHours = businessHours.find((h) => h.dayOfWeek === localTime.dayOfWeek);

  const qrValid =
    !settings.requireValidQrToken || params.qrToken?.trim() === branch.qrToken;

  let blockedReason: IntakeBlockedReason | null = null;
  if (!qrValid) {
    blockedReason = "QR_TOKEN_INVALID";
  } else if (!settings.isAcceptingTokens) {
    blockedReason = "QUEUE_PAUSED";
  } else if (
    settings.enforceBusinessHours &&
    !isWithinBusinessHours(todayHours, localTime.hhMm)
  ) {
    blockedReason = "BRANCH_CLOSED";
  }

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    branch: {
      id: branch.id,
      name: branch.name,
      slug: branch.slug,
      city: branch.city,
      address: branch.address,
      phone: branch.phone,
      timezone: branch.timezone,
    },
    intake: {
      canAcceptTokens: blockedReason === null,
      qrValid,
      reason: blockedReason,
      pausedReason: settings.queuePausedReason,
      waitingCount: waitProjection.waitingCount,
      estimatedNewJoinWaitMinutes: waitProjection.estimatedNewJoinWaitMinutes,
    },
    services: cachedServices.map((s) => ({
      id: s.serviceId,
      name: s.name,
      description: s.description,
      priceInPaise: s.priceInPaise,
      durationMinutes: s.durationMinutes,
    })),
    businessHours,
  };
}

export interface ValidatedSelectedService {
  serviceId: string;
  serviceNameSnapshot: string;
  priceInPaiseSnapshot: number;
  durationMinutesSnapshot: number;
}

/**
 * Validates that EVERY requested `serviceId` belongs to `(organizationId, branchId)`,
 * is active (`Service.isActive = true`), and is available at the branch (`BranchService.isAvailable = true`).
 * Rejects cross-tenant, cross-branch, or inactive services with `422 SERVICE_UNAVAILABLE` (`TI-04`).
 */
export async function validateBranchServiceSelection(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
  serviceIds: ReadonlyArray<string>,
): Promise<ValidatedSelectedService[]> {
  const uniqueIds = [...new Set(serviceIds)];
  if (uniqueIds.length === 0 || uniqueIds.length !== serviceIds.length) {
    throw new ServiceUnavailableError("Please select unique valid services.");
  }

  const rows = await tx.branchService.findMany({
    where: {
      organizationId,
      branchId,
      serviceId: { in: uniqueIds },
      isAvailable: true,
      service: { isActive: true },
    },
    select: {
      serviceId: true,
      priceOverrideInPaise: true,
      durationOverrideMinutes: true,
      service: {
        select: {
          name: true,
          basePriceInPaise: true,
          baseDurationMinutes: true,
        },
      },
    },
  });

  if (rows.length !== uniqueIds.length) {
    throw new ServiceUnavailableError(
      "One or more selected services are inactive or unavailable at this branch.",
    );
  }

  const byId = new Map(rows.map((r) => [r.serviceId, r]));

  return uniqueIds.map((serviceId) => {
    const row = byId.get(serviceId);
    if (!row) {
      throw new ServiceUnavailableError();
    }
    return {
      serviceId: row.serviceId,
      serviceNameSnapshot: row.service.name,
      priceInPaiseSnapshot: row.priceOverrideInPaise ?? row.service.basePriceInPaise,
      durationMinutesSnapshot:
        row.durationOverrideMinutes ?? row.service.baseDurationMinutes,
    };
  });
}
