"use client";

import { ChevronDown, MapPin } from "lucide-react";
import { cn } from "@/lib/formatters";

export interface BranchOption {
  id: string;
  name: string;
  city?: string | null;
  isActive?: boolean;
}

export interface BranchSwitcherProps {
  branches: ReadonlyArray<BranchOption>;
  selectedBranchId: string;
  onChange: (branchId: string) => void;
  label?: string;
  className?: string;
}

export function BranchSwitcher({
  branches,
  selectedBranchId,
  onChange,
  label = "Active branch",
  className,
}: BranchSwitcherProps) {
  if (branches.length === 0) {
    return null;
  }

  const currentBranch = branches.find((b) => b.id === selectedBranchId) ?? branches[0];

  if (branches.length === 1 && currentBranch) {
    return (
      <div
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-control border border-subtle bg-surface px-3 py-2 text-sm font-medium text-ink",
          className,
        )}
      >
        <MapPin className="h-4 w-4 shrink-0 text-brand-accent" aria-hidden="true" />
        <span className="truncate">{currentBranch.name}</span>
      </div>
    );
  }

  return (
    <div className={cn("relative flex items-center", className)}>
      <MapPin
        className="pointer-events-none absolute left-3 h-4 w-4 text-brand-accent"
        aria-hidden="true"
      />
      <select
        aria-label={label}
        value={currentBranch?.id ?? selectedBranchId}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-12 w-full appearance-none rounded-control border border-subtle bg-surface pl-9 pr-9 text-base font-medium text-ink focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 sm:text-sm"
      >
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.city ? `${branch.name} (${branch.city})` : branch.name}
            {branch.isActive === false ? " — Inactive" : ""}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 h-4 w-4 text-ink-secondary"
        aria-hidden="true"
      />
    </div>
  );
}
