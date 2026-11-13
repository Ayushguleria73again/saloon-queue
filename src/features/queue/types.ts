export type QueueTokenStatus =
  "WAITING" | "CALLED" | "IN_SERVICE" | "COMPLETED" | "SKIPPED" | "CANCELLED" | "NO_SHOW";

export type QueueTokenSource = "QR" | "WALK_IN";

export type StaffQueueAction =
  "START_SERVICE" | "COMPLETE" | "SKIP" | "CANCEL" | "MARK_NO_SHOW";

export interface QueueTokenServiceItemDto {
  serviceId: string;
  serviceName: string;
  priceInPaise: number;
  durationMinutes: number;
}

export interface QueueTokenItemDto {
  id: string;
  publicId: string;
  tokenNumber: string;
  sequenceNumber: number;
  status: QueueTokenStatus;
  source: QueueTokenSource;
  customerName: string;
  customerMobile: string;
  notes: string | null;
  totalPriceInPaise: number;
  totalDurationMinutes: number;
  estimatedWaitMinutes: number;
  peopleAhead: number;
  queuePosition: number;
  requeuedFromTokenId: string | null;
  createdAt: string;
  calledAt: string | null;
  serviceStartedAt: string | null;
  skippedAt: string | null;
  services: QueueTokenServiceItemDto[];
}

export interface BranchQueueKpisDto {
  totalTokens: number;
  waitingCount: number;
  calledCount: number;
  inServiceCount: number;
  completedCount: number;
  skippedCount: number;
  cancelledNoShowCount: number;
  avgWaitMinutes: number;
  avgServiceMinutes: number;
  revenueInPaise: number;
}

export interface BranchQueueOverviewDto {
  branchId: string;
  businessDate: string;
  isAcceptingTokens: boolean;
  queuePausedReason: string | null;
  activeStationsCount: number;
  estimatedNewJoinWaitMinutes: number;
  kpis: BranchQueueKpisDto;
  inServiceTokens: QueueTokenItemDto[];
  calledTokens: QueueTokenItemDto[];
  waitingTokens: QueueTokenItemDto[];
  skippedTokens: QueueTokenItemDto[];
}

export interface BranchHistoryItemDto {
  id: string;
  publicId: string;
  tokenNumber: string;
  businessDate: string;
  sequenceNumber: number;
  status: QueueTokenStatus;
  source: QueueTokenSource;
  customerName: string;
  customerMobile: string;
  notes: string | null;
  totalPriceInPaise: number;
  totalDurationMinutes: number;
  requeuedFromTokenId: string | null;
  requeuedToTokenId: string | null;
  createdAt: string;
  calledAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
  services: QueueTokenServiceItemDto[];
}

export interface BranchHistoryPageDto {
  items: BranchHistoryItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OwnerQueueSnapshotData {
  version: string;
  timestamp: string;
  overview: BranchQueueOverviewDto;
}
