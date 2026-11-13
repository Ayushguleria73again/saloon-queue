export interface PublicServiceOption {
  id: string;
  name: string;
  description: string | null;
  priceInPaise: number;
  durationMinutes: number;
}

export type PublicTokenStatus =
  "WAITING" | "CALLED" | "IN_SERVICE" | "COMPLETED" | "SKIPPED" | "CANCELLED" | "NO_SHOW";

export interface PublicTokenServiceSummary {
  name: string;
  priceInPaise: number;
  durationMinutes: number;
}

export interface PublicTokenTrackingDto {
  publicId: string;
  tokenNumber: string;
  status: PublicTokenStatus;
  customerName: string;
  maskedMobile: string;
  notes: string | null;
  queuePosition: number;
  peopleAhead: number;
  estimatedWaitMinutes: number;
  totalPriceInPaise: number;
  totalDurationMinutes: number;
  canCustomerCancel: boolean;
  allowCustomerCancelSetting: boolean;
  pushAlertsEnabled: boolean;
  organization: {
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
  services: PublicTokenServiceSummary[];
  requeuedTo: {
    publicId: string;
    tokenNumber: string;
    url: string;
  } | null;
  createdAt: string;
  calledAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
}

export interface CustomerTokenUpdateData {
  publicId: string;
  tokenNumber: string;
  status: PublicTokenStatus;
  queuePosition: number;
  peopleAhead: number;
  estimatedWaitMinutes: number;
  totalPriceInPaise: number;
  totalDurationMinutes: number;
  updatedAt: string;
  isTerminal: boolean;
  requeuedTo?: {
    publicId: string;
    tokenNumber: string;
    url: string;
  } | null;
}
