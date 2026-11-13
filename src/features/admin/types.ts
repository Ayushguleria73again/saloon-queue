export type OrganizationStatusType =
  | "PENDING"
  | "ACTIVE"
  | "SUSPENDED"
  | "DEACTIVATED";

export type OutboxEventStatusType =
  | "PENDING"
  | "PROCESSING"
  | "PROCESSED"
  | "RETRYING"
  | "DEAD_LETTER";

export interface PlatformOverviewDto {
  organizations: {
    total: number;
    active: number;
    pending: number;
    suspended: number;
    deactivated: number;
  };
  branches: {
    total: number;
    active: number;
  };
  tokens: {
    todayTotal: number;
    todayCompleted: number;
    todayServingOrWaiting: number;
  };
  jobs: {
    pending: number;
    processing: number;
    retrying: number;
    deadLetter: number;
  };
}

export interface AdminTenantItemDto {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatusType;
  createdAt: string;
  updatedAt: string;
  branchCount: number;
  memberCount: number;
  thirtyDayTokenCount: number;
  ownerEmail: string | null;
  ownerName: string | null;
}

export interface AdminTenantListResponseDto {
  items: AdminTenantItemDto[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminJobItemDto {
  id: string;
  organizationId: string;
  organizationName: string;
  branchId: string | null;
  branchName: string | null;
  eventType: string;
  status: OutboxEventStatusType;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminJobListResponseDto {
  items: AdminJobItemDto[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PlatformHealthDetailsDto {
  status: "healthy" | "degraded";
  database: {
    connected: boolean;
    latencyMs: number;
  };
  vapidConfigured: boolean;
  nodeVersion: string;
  uptimeSeconds: number;
  timestamp: string;
}

