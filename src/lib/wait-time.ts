export interface ActiveWaitTokenInput {
  id: string;
  totalDurationMinutes: number;
  serviceStartedAt?: Date | null;
}

export interface TokenWaitProjection {
  tokenId: string;
  estimatedWaitMinutes: number;
  peopleAhead: number;
  queuePosition: number;
}

export interface BranchWaitSimulationResult {
  byTokenId: Map<string, TokenWaitProjection>;
  estimatedNewJoinWaitMinutes: number;
}

const OVERDUE_FLOOR_MINUTES = 3;
const MIN_OVERRUN_FACTOR = 0.85;
const MAX_OVERRUN_FACTOR = 1.35;

export function clampOverrunFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1.0;
  return Math.min(MAX_OVERRUN_FACTOR, Math.max(MIN_OVERRUN_FACTOR, factor));
}

function findEarliestStationIndex(stations: number[]): number {
  let minIdx = 0;
  let minVal = stations[0] ?? 0;

  for (let i = 1; i < stations.length; i += 1) {
    const val = stations[i] ?? 0;
    if (val < minVal) {
      minVal = val;
      minIdx = i;
    }
  }

  return minIdx;
}

/**
 * Earliest-Free-Station O(N * K) FIFO waiting-time simulator (`WAITING_TIME_ENGINE.md`).
 * Input arrays must already be deterministically ordered:
 * - `inServiceTokens`: `serviceStartedAt ASC`
 * - `calledTokens`: `calledAt ASC, sequenceNumber ASC`
 * - `waitingTokens`: `sequenceNumber ASC`
 */
export function calculateBranchWaitTimes(params: {
  activeStationsCount: number;
  bufferMinutes?: number;
  overrunFactor?: number;
  now?: Date;
  inServiceTokens: ReadonlyArray<ActiveWaitTokenInput>;
  calledTokens: ReadonlyArray<ActiveWaitTokenInput>;
  waitingTokens: ReadonlyArray<ActiveWaitTokenInput>;
}): BranchWaitSimulationResult {
  const stationCount = Math.max(1, Math.floor(params.activeStationsCount));
  const bufferMinutes = Math.max(0, Math.floor(params.bufferMinutes ?? 0));
  const overrunFactor = clampOverrunFactor(params.overrunFactor ?? 1.0);
  const nowMs = (params.now ?? new Date()).getTime();

  const stations = new Array<number>(stationCount).fill(0);
  const byTokenId = new Map<string, TokenWaitProjection>();

  // 1. Seed active IN_SERVICE tokens across K stations
  for (let i = 0; i < params.inServiceTokens.length; i += 1) {
    const token = params.inServiceTokens[i];
    if (!token) continue;

    const startedMs = token.serviceStartedAt ? token.serviceStartedAt.getTime() : nowMs;
    const elapsedMins = Math.max(0, (nowMs - startedMs) / 60_000);
    const expectedMins = Math.round(token.totalDurationMinutes * overrunFactor);
    const remainingMins = Math.max(
      OVERDUE_FLOOR_MINUTES,
      Math.round(expectedMins - elapsedMins),
    );

    if (i < stationCount) {
      stations[i] = remainingMins;
    } else {
      const minIdx = findEarliestStationIndex(stations);
      stations[minIdx] = (stations[minIdx] ?? 0) + remainingMins;
    }

    byTokenId.set(token.id, {
      tokenId: token.id,
      estimatedWaitMinutes: 0,
      peopleAhead: 0,
      queuePosition: 0,
    });
  }

  // 2. Schedule CALLED tokens ahead of WAITING
  for (let i = 0; i < params.calledTokens.length; i += 1) {
    const token = params.calledTokens[i];
    if (!token) continue;

    const minIdx = findEarliestStationIndex(stations);
    const expectedDuration =
      Math.round(token.totalDurationMinutes * overrunFactor) + bufferMinutes;
    stations[minIdx] = (stations[minIdx] ?? 0) + expectedDuration;

    byTokenId.set(token.id, {
      tokenId: token.id,
      estimatedWaitMinutes: 0,
      peopleAhead: 0,
      queuePosition: 1,
    });
  }

  // 3. Schedule WAITING tokens in strict FIFO order
  let peopleAhead = params.calledTokens.length;
  for (const token of params.waitingTokens) {
    const minIdx = findEarliestStationIndex(stations);
    const waitMinutes = stations[minIdx] ?? 0;

    byTokenId.set(token.id, {
      tokenId: token.id,
      estimatedWaitMinutes: waitMinutes,
      peopleAhead,
      queuePosition: peopleAhead + 1,
    });

    const expectedDuration =
      Math.round(token.totalDurationMinutes * overrunFactor) + bufferMinutes;
    stations[minIdx] = waitMinutes + expectedDuration;
    peopleAhead += 1;
  }

  const nextMinIdx = findEarliestStationIndex(stations);
  return {
    byTokenId,
    estimatedNewJoinWaitMinutes: stations[nextMinIdx] ?? 0,
  };
}
