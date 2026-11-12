import type { ReactNode } from "react";
import { cn } from "@/lib/formatters";

export type StatCardTone = "default" | "accent" | "warning";

export interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  tone?: StatCardTone;
  className?: string;
}

const TONE_CLASSES: Record<StatCardTone, string> = {
  default: "border-subtle bg-surface",
  accent: "border-brand-accent/30 bg-surface",
  warning: "border-status-waiting-fg/25 bg-status-waiting-bg/35",
};

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  tone = "default",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-card border p-4 shadow-sm transition",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {label}
        </span>
        {icon ? <span className="text-ink-secondary">{icon}</span> : null}
      </div>

      <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink sm:text-3xl">
        {value}
      </div>

      {subtitle ? <p className="mt-1 text-xs text-ink-secondary">{subtitle}</p> : null}
    </div>
  );
}
