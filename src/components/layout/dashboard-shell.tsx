"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BarChart3,
  Building2,
  History,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  QrCode,
  Scissors,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { BranchSwitcher, type BranchOption } from "@/components/ui/branch-switcher";
import { cn } from "@/lib/formatters";

export interface DashboardNavItem {
  href: string;
  label: string;
  mobileLabel: string;
  requiredPermission?: string;
  primaryMobile: boolean;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

export const OWNER_NAV_ITEMS: ReadonlyArray<DashboardNavItem> = [
  {
    href: "/owner/dashboard",
    label: "Dashboard",
    mobileLabel: "Home",
    primaryMobile: true,
    Icon: LayoutDashboard,
  },
  {
    href: "/owner/queue",
    label: "Live Queue",
    mobileLabel: "Queue",
    requiredPermission: "QUEUE_VIEW",
    primaryMobile: true,
    Icon: ListOrdered,
  },
  {
    href: "/owner/services",
    label: "Services",
    mobileLabel: "Services",
    requiredPermission: "SERVICE_MANAGE",
    primaryMobile: true,
    Icon: Sparkles,
  },
  {
    href: "/owner/qr",
    label: "QR Studio",
    mobileLabel: "QR",
    requiredPermission: "QR_MANAGE",
    primaryMobile: true,
    Icon: QrCode,
  },
  {
    href: "/owner/branches",
    label: "Branches",
    mobileLabel: "Branches",
    requiredPermission: "BRANCH_MANAGE",
    primaryMobile: false,
    Icon: Building2,
  },
  {
    href: "/owner/staff",
    label: "Staff & Roles",
    mobileLabel: "Staff",
    requiredPermission: "STAFF_MANAGE",
    primaryMobile: false,
    Icon: Users,
  },
  {
    href: "/owner/history",
    label: "History",
    mobileLabel: "History",
    requiredPermission: "HISTORY_VIEW",
    primaryMobile: false,
    Icon: History,
  },
  {
    href: "/owner/analytics",
    label: "Analytics",
    mobileLabel: "Analytics",
    requiredPermission: "ANALYTICS_VIEW",
    primaryMobile: false,
    Icon: BarChart3,
  },
  {
    href: "/owner/settings",
    label: "Settings",
    mobileLabel: "Settings",
    primaryMobile: true,
    Icon: Settings,
  },
];

export function filterDashboardNavItems(
  permissions?: ReadonlySet<string>,
): ReadonlyArray<DashboardNavItem> {
  if (!permissions) {
    return OWNER_NAV_ITEMS;
  }

  return OWNER_NAV_ITEMS.filter(
    (item) => !item.requiredPermission || permissions.has(item.requiredPermission),
  );
}

export interface DashboardShellProps {
  children: ReactNode;
  organizationName?: string;
  branches?: ReadonlyArray<BranchOption>;
  selectedBranchId?: string;
  onBranchChange?: (branchId: string) => void;
  permissionKeys?: ReadonlyArray<string>;
}

export function DashboardShell({
  children,
  organizationName = "SalonFlow Workspace",
  branches = [],
  selectedBranchId = "",
  onBranchChange,
  permissionKeys,
}: DashboardShellProps) {
  const pathname = usePathname();
  const permissionSet = permissionKeys ? new Set(permissionKeys) : undefined;
  const visibleItems = filterDashboardNavItems(permissionSet);
  const mobileBottomItems = visibleItems.filter((item) => item.primaryMobile).slice(0, 5);

  return (
    <div className="min-h-screen bg-dashboard text-ink md:flex">
      {/* Desktop Sidebar (240px / w-60) */}
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-subtle bg-surface md:flex">
        <div className="border-b border-subtle px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-control bg-brand-primary text-brand-foreground">
              <Scissors className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">SalonFlow</p>
              <p className="truncate text-xs text-ink-secondary">{organizationName}</p>
            </div>
          </div>

          {branches.length > 0 && onBranchChange ? (
            <div className="mt-3">
              <BranchSwitcher
                branches={branches}
                selectedBranchId={selectedBranchId}
                onChange={onBranchChange}
              />
            </div>
          ) : null}
        </div>

        <nav aria-label="Owner workspace navigation" className="flex-1 space-y-1 p-3">
          {visibleItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                <Icon className="h-4 w-4 shrink-0" aria-hidden={true} />
                <span className="truncate">{item.label}</span>
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

      {/* Mobile Top Bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-subtle bg-surface px-4 py-3 pt-safe md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-primary text-brand-foreground">
              <Scissors className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="truncate text-sm font-bold text-ink">
              {organizationName}
            </span>
          </div>

          {branches.length > 0 && onBranchChange ? (
            <div className="max-w-[180px] shrink-0">
              <BranchSwitcher
                branches={branches}
                selectedBranchId={selectedBranchId}
                onChange={onBranchChange}
              />
            </div>
          ) : null}
        </header>

        <main className="flex-1 px-4 py-5 pb-24 sm:px-6 md:px-8 md:py-6 md:pb-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation */}
      <nav
        aria-label="Mobile quick navigation"
        className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-subtle bg-surface pb-safe md:hidden"
      >
        {mobileBottomItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.Icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition",
                active ? "text-ink" : "text-ink-secondary hover:text-ink",
              )}
            >
              <Icon
                className={cn("h-4 w-4", active && "text-brand-accent")}
                aria-hidden={true}
              />
              <span>{item.mobileLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
