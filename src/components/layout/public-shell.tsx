import type { ReactNode } from "react";
import { cn } from "@/lib/formatters";

export interface PublicShellProps {
  children: ReactNode;
  className?: string;
}

export function PublicShell({ children, className }: PublicShellProps) {
  return (
    <div className={cn("min-h-screen bg-canvas text-ink pb-safe", className)}>
      <div className="mx-auto w-full max-w-xl px-4 py-6 sm:py-8">{children}</div>
    </div>
  );
}
