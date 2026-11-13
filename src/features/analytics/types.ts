export type AnalyticsRangePreset = "today" | "7d" | "30d" | "90d" | "custom";

export type AnalyticsGranularity = "day" | "week" | "month";

export interface AnalyticsSummaryDto {
  totalTokens: number;
  completedTokens: number;
  cancelledTokens: number;
  noShowTokens: number;
  skippedTokens: number;
  servingOrWaitingTokens: number;
  completionRate: number;
  averageWaitMinutes: number;
  averageServiceDurationMinutes: number;
  totalRevenuePaise: number;
  walkInTokensCount: number;
  qrTokensCount: number;
}

export interface AnalyticsTrendPointDto {
  periodKey: string;
  label: string;
  totalTokens: number;
  completedTokens: number;
  cancelledTokens: number;
  noShowTokens: number;
  averageWaitMinutes: number;
  averageServiceDurationMinutes: number;
  totalRevenuePaise: number;
}

export interface TopServiceDto {
  serviceId: string;
  serviceName: string;
  tokenCount: number;
  totalRevenuePaise: number;
  averageDurationMinutes: number;
  percentageOfTotal: number;
}

export interface BranchComparisonDto {
  branchId: string;
  branchName: string;
  branchSlug: string;
  isActive: boolean;
  totalTokens: number;
  completedTokens: number;
  cancelledTokens: number;
  noShowTokens: number;
  completionRate: number;
  averageWaitMinutes: number;
  averageServiceDurationMinutes: number;
  totalRevenuePaise: number;
}

export interface AnalyticsReportDto {
  range: AnalyticsRangePreset;
  dateFrom: string;
  dateTo: string;
  granularity: AnalyticsGranularity;
  selectedBranchId: string | null;
  summary: AnalyticsSummaryDto;
  trends: AnalyticsTrendPointDto[];
  topServices: TopServiceDto[];
  branches: BranchComparisonDto[];
}

