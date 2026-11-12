export const PERMISSION_KEYS = [
  "QUEUE_VIEW",
  "QUEUE_CREATE_WALKIN",
  "QUEUE_CALL_NEXT",
  "QUEUE_START",
  "QUEUE_COMPLETE",
  "QUEUE_SKIP",
  "QUEUE_CANCEL",
  "QUEUE_NO_SHOW",
  "HISTORY_VIEW",
  "QR_MANAGE",
  "SERVICE_MANAGE",
  "BRANCH_MANAGE",
  "STAFF_MANAGE",
  "SETTINGS_MANAGE",
  "ANALYTICS_VIEW",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export interface SessionUserClaims {
  id: string;
  email: string;
  name: string;
  activeOrganizationId: string | null;
  sessionVersion: number;
  isPlatformAdmin: boolean;
}

export interface AuthorizedTenantContext {
  userId: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  organizationId: string;
  organizationName: string;
  memberId: string;
  roleSlug: string;
  allBranches: boolean;
  permissions: ReadonlySet<PermissionKey>;
  allowedBranchIds: ReadonlySet<string>;
  branchId?: string;
}

export interface PlatformAdminContext {
  userId: string;
  email: string;
  name: string;
  isPlatformAdmin: true;
}
