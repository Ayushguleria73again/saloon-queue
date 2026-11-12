import { PERMISSION_KEYS, type PermissionKey } from "./types";

export interface DefaultRoleDefinition {
  name: string;
  slug: "OWNER" | "MANAGER" | "STAFF";
  permissions: readonly PermissionKey[];
}

export const DEFAULT_ROLE_DEFINITIONS: readonly DefaultRoleDefinition[] = [
  {
    name: "Owner",
    slug: "OWNER",
    permissions: PERMISSION_KEYS,
  },
  {
    name: "Manager",
    slug: "MANAGER",
    permissions: [
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
      "ANALYTICS_VIEW",
    ],
  },
  {
    name: "Staff",
    slug: "STAFF",
    permissions: [
      "QUEUE_VIEW",
      "QUEUE_CREATE_WALKIN",
      "QUEUE_CALL_NEXT",
      "QUEUE_START",
      "QUEUE_COMPLETE",
      "QUEUE_SKIP",
      "QUEUE_CANCEL",
      "QUEUE_NO_SHOW",
      "HISTORY_VIEW",
    ],
  },
] as const;
