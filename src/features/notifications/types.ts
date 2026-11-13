export type NotificationDeliveryUiStatus =
  | "QUEUED"
  | "ACCEPTED_BY_PROVIDER"
  | "RETRYING"
  | "FAILED"
  | "DEAD_LETTER"
  | "ACKNOWLEDGED";

export interface OwnerPushSubscriptionDto {
  id: string;
  branchId: string | null;
  branchName: string | null;
  deviceLabel: string | null;
  endpointHost: string;
  isActive: boolean;
  preferences: {
    newToken: boolean;
    longQueue: boolean;
    testAlerts: boolean;
  };
  lastUsedAt: string | null;
  createdAt: string;
}

export interface OwnerNotificationLogDto {
  id: string;
  notificationEventId: string;
  eventType: string;
  eventStatus: string;
  attemptCount: number;
  title: string;
  body: string;
  targetUrl: string;
  status: NotificationDeliveryUiStatus;
  createdAt: string;
  acknowledgedAt: string | null;
  lastError: string | null;
  latestDelivery: {
    httpStatusCode: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    durationMs: number | null;
    attemptedAt: string;
  } | null;
}
