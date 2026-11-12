import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ToastProvider } from "@/components/ui/toast";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  let organizationName = "SalonFlow Workspace";
  let permissionKeys: string[] = [];

  try {
    const ctx = await authorizeTenantAction();
    organizationName = ctx.organizationName;
    permissionKeys = [...ctx.permissions];
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError && error.code === "TENANT_SUSPENDED") {
      return (
        <main className="flex min-h-screen items-center justify-center bg-dashboard px-4">
          <div className="w-full max-w-md rounded-card border border-subtle bg-surface p-6 text-center shadow-sm">
            <h1 className="text-xl font-bold text-ink">Organization Suspended</h1>
            <p className="mt-2 text-sm text-ink-secondary">{error.message}</p>
          </div>
        </main>
      );
    }
    throw error;
  }

  return (
    <ToastProvider>
      <DashboardShell organizationName={organizationName} permissionKeys={permissionKeys}>
        {children}
      </DashboardShell>
    </ToastProvider>
  );
}
