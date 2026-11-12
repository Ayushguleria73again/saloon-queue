import type { Prisma } from "@prisma/client";
import {
  calculateBranchWaitTimes,
  clampOverrunFactor,
  type BranchWaitSimulationResult,
} from "@/lib/wait-time";

export const DEFAULT_OVERRUN_SAMPLE_THRESHOLD = 20;
const OVERRUN_LOOKBACK_DAYS = 30;
const MAX_OVERRUN_SAMPLE_SIZE = 200;

export interface BranchWaitSnapshot extends BranchWaitSimulationResult {
  overrunFactor: number;
  waitingCount: number;
}

/**
 * Pure helper computing bounded historical overrun factor from completed token timings.
 * Exposed for deterministic unit testing and used by `computeHistoricalOverrunFactor`.
 */
export function deriveHistoricalOverrunFactorFromSamples(
  samples: ReadonlyArray<{
    plannedDurationMinutes: number;
    actualDurationMinutes: number;
  }>,
  sampleThreshold: number = DEFAULT_OVERRUN_SAMPLE_THRESHOLD,
): number {
  const validSamples = samples.filter(
    (s) =>
      Number.isFinite(s.plannedDurationMinutes) &&
      s.plannedDurationMinutes > 0 &&
      Number.isFinite(s.actualDurationMinutes) &&
      s.actualDurationMinutes >= 0,
  );

  if (validSamples.length < sampleThreshold) {
    return 1.0;
  }

  let totalPlanned = 0;
  let totalActual = 0;
  for (const sample of validSamples) {
    totalPlanned += sample.plannedDurationMinutes;
    totalActual += sample.actualDurationMinutes;
  }

  if (totalPlanned <= 0) {
    return 1.0;
  }

  return clampOverrunFactor(totalActual / totalPlanned);
}

/**
 * Computes recent 30-day branch duration overrun factor when at least 20 completed tokens exist.
 */
export async function computeHistoricalOverrunFactor(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
  now: Date = new Date(),
): Promise<number> {
  const lookbackStart = new Date(
    now.getTime() - OVERRUN_LOOKBACK_DAYS * 24 * 60 * 60_000,
  );

  const completedRows = await tx.token.findMany({
    where: {
      organizationId,
      branchId,
      status: "COMPLETED",
      totalDurationMinutes: { gt: 0 },
      serviceStartedAt: { not: null },
      completedAt: { not: null, gte: lookbackStart },
    },
    orderBy: [{ completedAt: "desc" }],
    take: MAX_OVERRUN_SAMPLE_SIZE,
    select: {
      totalDurationMinutes: true,
      serviceStartedAt: true,
      completedAt: true,
    },
  });

  const samples = completedRows.flatMap((row) => {
    if (!row.serviceStartedAt || !row.completedAt) {
      return [];
    }
    const actualMinutes =
      (row.completedAt.getTime() - row.serviceStartedAt.getTime()) / 60_000;
    if (!Number.isFinite(actualMinutes) || actualMinutes < 0) {
      return [];
    }
    return [
      {
        plannedDurationMinutes: row.totalDurationMinutes,
        actualDurationMinutes: actualMinutes,
      },
    ];
  });

  return deriveHistoricalOverrunFactorFromSamples(samples);
}

/**
 * Calculates live queue positions and station-simulated wait estimates for a branch business day.
 */
export async function computeBranchWaitSnapshot(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    branchId: string;
    businessDate: Date;
    activeStationsCount: number;
    bufferMinutes?: number;
    now?: Date;
    includeHistoricalOverrun?: boolean;
  },
): Promise<BranchWaitSnapshot> {
  const now = params.now ?? new Date();

  const activeTokens = await tx.token.findMany({
    where: {
      organizationId: params.organizationId,
      branchId: params.branchId,
      businessDate: params.businessDate,
      status: { in: ["IN_SERVICE", "CALLED", "WAITING"] },
    },
    orderBy: [{ sequenceNumber: "asc" }],
    select: {
      id: true,
      status: true,
      serviceStartedAt: true,
      calledAt: true,
      sequenceNumber: true,
      totalDurationMinutes: true,
    },
  });

  const inServiceTokens = activeTokens
    .filter((token) => token.status === "IN_SERVICE")
    .sort(
      (a, b) =>
        (a.serviceStartedAt?.getTime() ?? 0) - (b.serviceStartedAt?.getTime() ?? 0),
    );

  const calledTokens = activeTokens
    .filter((token) => token.status === "CALLED")
    .sort(
      (a, b) =>
        (a.calledAt?.getTime() ?? 0) - (b.calledAt?.getTime() ?? 0) ||
        a.sequenceNumber - b.sequenceNumber,
    );

  const waitingTokens = activeTokens.filter((token) => token.status === "WAITING");

  const overrunFactor =
    params.includeHistoricalOverrun === false
      ? 1.0
      : await computeHistoricalOverrunFactor(
          tx,
          params.organizationId,
          params.branchId,
          now,
        );

  const summary = calculateBranchWaitTimes({
    activeStationsCount: params.activeStationsCount,
    bufferMinutes: params.bufferMinutes ?? 0,
    overrunFactor,
    now,
    inServiceTokens,
    calledTokens,
    waitingTokens,
  });

  return {
    ...summary,
    overrunFactor,
    waitingCount: waitingTokens.length,
  };
}
