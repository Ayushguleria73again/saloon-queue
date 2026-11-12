"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Activity, Building, LogOut, ShieldCheck, Wrench } from "lucide-react";
import { cn } from "@/lib/formatters";

const ADMIN_NAV_ITEMS = [
  { href: "/admin", label: "Platform Overview", Icon: Activity },
  { href: "/admin/tenants", label: "Tenants Directory", Icon: Building },
  { href: "/admin/jobs", label: "Background Jobs", Icon: Wrench },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-dashboard text-ink md:flex">
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-subtle bg-surface md:flex">
        <div className="flex items-center gap-2.5 border-b border-subtle px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-control bg-brand-primary text-brand-foreground">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">SalonFlow</p>
            <p className="truncate text-xs text-ink-secondary">Platform Admin</p>
          </div>
        </div>

        <nav aria-label="Platform admin navigation" className="flex-1 space-y-1 p-3">
          {ADMIN_NAV_ITEMS.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            const Icon = item.Icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-brand-primary text-brand-foreground"
                    : "text-ink-secondary hover:bg-muted hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-subtle p-3">
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted hover:text-ink"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center justify-between border-b border-subtle bg-surface px-4 py-3 pt-safe md:hidden">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand-accent" aria-hidden="true" />
            <span className="text-sm font-bold text-ink">Platform Admin</span>
          </div>
          <nav className="flex items-center gap-2" aria-label="Admin mobile links">
            {ADMIN_NAV_ITEMS.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-control px-2.5 py-1.5 text-xs font-medium",
                    active
                      ? "bg-brand-primary text-brand-foreground"
                      : "text-ink-secondary hover:bg-muted",
                  )}
                >
                  {item.label.split(" ")[0]}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 px-4 py-5 sm:px-6 md:px-8 md:py-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
