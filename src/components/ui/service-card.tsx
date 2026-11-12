"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, Clock } from "lucide-react";
import { cn, formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";

export interface ServiceCardProps {
  id: string;
  name: string;
  description?: string | null;
  priceInPaise: number;
  durationMinutes: number;
  selected: boolean;
  disabled?: boolean;
  onToggle: (serviceId: string) => void;
}

export function ServiceCard({
  id,
  name,
  description,
  priceInPaise,
  durationMinutes,
  selected,
  disabled = false,
  onToggle,
}: ServiceCardProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={() => onToggle(id)}
      whileTap={prefersReducedMotion || disabled ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.12 }}
      className={cn(
        "flex min-h-12 w-full items-start justify-between gap-3 rounded-card border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30 disabled:cursor-not-allowed disabled:opacity-55",
        selected
          ? "border-brand-primary bg-surface ring-1 ring-brand-primary"
          : "border-subtle bg-surface hover:border-ink-secondary/40",
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-ink">{name}</span>
        </div>
        {description ? (
          <p className="line-clamp-2 text-sm text-ink-secondary">{description}</p>
        ) : null}
        <div className="flex items-center gap-3 pt-1 text-xs font-medium text-ink-secondary">
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {formatDurationMinutes(durationMinutes)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="font-mono text-base font-bold tabular-nums text-ink">
          {formatPaiseToInr(priceInPaise)}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full border transition",
            selected
              ? "border-brand-primary bg-brand-primary text-brand-foreground"
              : "border-subtle bg-canvas text-transparent",
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      </div>
    </motion.button>
  );
}
