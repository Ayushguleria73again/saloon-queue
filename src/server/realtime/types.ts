export type { CustomerTokenUpdateData } from "@/features/public-intake/types";
export type { OwnerQueueSnapshotData } from "@/features/queue/types";

export interface QueueMutationBroadcast {
  organizationId: string;
  branchId: string;
  tokenId?: string;
  tokenNumber?: string;
  action: string;
  timestamp: string;
}

export interface BaseSubscriber {
  id: string;
  organizationId: string;
  branchId: string;
  send: (rawSseMessage: string) => void;
  close: () => void;
}

export interface OwnerSubscriber extends BaseSubscriber {
  type: "OWNER";
}

export interface CustomerSubscriber extends BaseSubscriber {
  type: "CUSTOMER";
  tokenId: string;
  publicId: string;
}

export type RealtimeSubscriber = OwnerSubscriber | CustomerSubscriber;

export function buildBranchChannelKey(organizationId: string, branchId: string): string {
  return `branch:${organizationId}:${branchId}`;
}
