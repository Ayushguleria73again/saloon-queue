import type { ComponentType } from "react";
import {
  BellRing,
  CheckCircle2,
  Clock,
  Scissors,
  SkipForward,
  UserX,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/formatters";

export type TokenUiStatus =
  "WAITING" | "CALLED" | "IN_SERVICE" | "COMPLETED" | "SKIPPED" | "CANCELLED" | "NO_SHOW";

interface StatusMeta {
  label: string;
  colorClasses: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const STATUS_META_MAP: Record<TokenUiStatus, StatusMeta> = {
  WAITING: {
    label: "Waiting",
    colorClasses: "bg-status-waiting-bg text-status-waiting-fg",
    Icon: Clock,
  },
  CALLED: {
    label: "Called",
    colorClasses: "bg-status-called-bg text-status-called-fg",
    Icon: BellRing,
  },
  IN_SERVICE: {
    label: "In Service",
    colorClasses: "bg-status-inservice-bg text-status-inservice-fg",
    Icon: Scissors,
  },
  COMPLETED: {
    label: "Completed",
    colorClasses: "bg-status-completed-bg text-status-completed-fg",
    Icon: CheckCircle2,
  },
  SKIPPED: {
    label: "Skipped",
    colorClasses: "bg-status-skipped-bg text-status-skipped-fg",
    Icon: SkipForward,
  },
  CANCELLED: {
    label: "Cancelled",
    colorClasses: "bg-status-cancelled-bg text-status-cancelled-fg",
    Icon: XCircle,
  },
  NO_SHOW: {
    label: "No Show",
    colorClasses: "bg-status-noshow-bg text-status-noshow-fg",
    Icon: UserX,
  },
};

export interface StatusBadgeProps {
  status: TokenUiStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, colorClasses, Icon } = STATUS_META_MAP[status];

  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
        colorClasses,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
      <span>{label}</span>
    </span>
  );
}
