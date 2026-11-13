import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  Clock,
  History,
  ListOrdered,
  MapPin,
  QrCode,
  Scissors,
  Users,
} from "lucide-react";
import { StatCard } from "@/components/ui";
import { formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";
import { authorizeTenantAction } from "@/server/auth";
import { listAccessibleBranches } from "@/server/services/branch-service";
import { getBranchQueueOverview } from "@/server/services/queue-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Owner Dashboard — SalonFlow",
};

export default async function OwnerDashboardPage(props: {
  searchParams: Promise<{ branchId?: string }>;
}) {
  const { branchId: requestedBranchId } = await props.searchParams;
  const ctx = await authorizeTenantAction();
  const branches = await listAccessibleBranches(ctx);

  const canViewQueue = ctx.permissions.has("QUEUE_VIEW");
  const canManageQr = ctx.permissions.has("QR_MANAGE");
  const canViewHistory = ctx.permissions.has("HISTORY_VIEW");
  const canManageBranches = ctx.permissions.has("BRANCH_MANAGE");
  const canManageStaff = ctx.permissions.has("STAFF_MANAGE");

  const activeBranch =
    branches.find((b) => b.id === requestedBranchId) ?? branches[0] ?? null;

  let queueOverview = null;
  if (activeBranch && canViewQueue) {
    const branchCtx = await authorizeTenantAction({
      requiredPermission: "QUEUE_VIEW",
      branchId: activeBranch.id,
    });
    queueOverview = await getBranchQueueOverview(branchCtx, activeBranch.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {ctx.organizationName}
          </h1>
          <p className="text-sm text-ink-secondary">
            Signed in as {ctx.name} ({ctx.roleSlug})
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canViewQueue && activeBranch ? (
            <Link
              href={`/owner/queue?branchId=${encodeURIComponent(activeBranch.id)}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:opacity-95"
            >
              <ListOrdered className="h-4 w-4" aria-hidden="true" />
              <span>Open Live Queue</span>
            </Link>
          ) : null}

          {canManageQr && activeBranch ? (
            <Link
              href={`/owner/qr?branchId=${encodeURIComponent(activeBranch.id)}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-subtle bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:bg-muted"
            >
              <QrCode className="h-4 w-4" aria-hidden="true" />
              <span>QR Studio</span>
            </Link>
          ) : null}

          {canViewHistory && activeBranch ? (
            <Link
              href={`/owner/history?branchId=${encodeURIComponent(activeBranch.id)}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-subtle bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:bg-muted"
            >
              <History className="h-4 w-4" aria-hidden="true" />
              <span>History</span>
            </Link>
          ) : null}
        </div>
      </div>

      {queueOverview ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
              Today at {activeBranch?.name}
            </h2>
            <span className="font-mono text-xs text-ink-secondary">
              {queueOverview.businessDate}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Waiting in Queue"
              value={queueOverview.kpis.waitingCount}
              subtitle={`Est. new wait ~${formatDurationMinutes(queueOverview.estimatedNewJoinWaitMinutes)}`}
              tone="accent"
              icon={<Users className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard
              label="In Service / Called"
              value={`${queueOverview.kpis.inServiceCount} / ${queueOverview.kpis.calledCount}`}
              subtitle={`${queueOverview.activeStationsCount} active station(s)`}
              icon={<Scissors className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard
              label="Completed Today"
              value={queueOverview.kpis.completedCount}
              subtitle={`Avg wait ${queueOverview.kpis.avgWaitMinutes}m • Avg svc ${queueOverview.kpis.avgServiceMinutes}m`}
              icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard
              label="Today's Revenue"
              value={formatPaiseToInr(queueOverview.kpis.revenueInPaise)}
              subtitle={`${queueOverview.kpis.totalTokens} total tickets`}
              icon={<Clock className="h-4 w-4" aria-hidden="true" />}
            />
          </div>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Accessible Branches"
            value={branches.length}
            subtitle="Active physical locations"
            icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
          />
          <StatCard
            label="Role & Scope"
            value={ctx.roleSlug}
            subtitle={
              ctx.allBranches ? "All organization branches" : "Assigned branch scope"
            }
          />
          <StatCard label="Workspace Status" value="Ready" tone="accent" />
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">Accessible Branches</h2>
          <div className="flex flex-wrap gap-3 text-xs font-medium text-ink-secondary">
            {canManageBranches ? (
              <Link
                href="/owner/branches"
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                Manage Branches
              </Link>
            ) : null}
            {canManageStaff ? (
              <Link
                href="/owner/staff"
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Staff &amp; Roles
              </Link>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {branches.map((branch) => (
            <div
              key={branch.id}
              className="flex flex-col justify-between gap-3 rounded-card border border-subtle bg-surface p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-ink">{branch.name}</h3>
                  {branch.city ? (
                    <p className="text-xs text-ink-secondary">{branch.city}</p>
                  ) : null}
                </div>
                <span
                  className={
                    branch.isActive
                      ? "rounded-full bg-status-completed-bg px-2.5 py-0.5 text-xs font-semibold text-status-completed-fg"
                      : "rounded-full bg-status-skipped-bg px-2.5 py-0.5 text-xs font-semibold text-status-skipped-fg"
                  }
                >
                  {branch.isActive ? "Active" : "Paused"}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-subtle pt-3">
                {canViewQueue ? (
                  <Link
                    href={`/owner/queue?branchId=${encodeURIComponent(branch.id)}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-muted px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle/60"
                  >
                    <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
                    Queue
                  </Link>
                ) : null}
                {canManageQr ? (
                  <Link
                    href={`/owner/qr?branchId=${encodeURIComponent(branch.id)}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-muted px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle/60"
                  >
                    <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                    QR Code
                  </Link>
                ) : null}
                {canViewHistory ? (
                  <Link
                    href={`/owner/history?branchId=${encodeURIComponent(branch.id)}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-muted px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle/60"
                  >
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                    History
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
