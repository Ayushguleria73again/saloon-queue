import Link from "next/link";
import { Building2, CheckCircle2, MapPin, Users } from "lucide-react";
import { StatCard } from "@/components/ui";
import { authorizeTenantAction } from "@/server/auth";
import { listAccessibleBranches } from "@/server/services/branch-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Owner Dashboard — SalonFlow",
};

export default async function OwnerDashboardPage() {
  const ctx = await authorizeTenantAction();
  const branches = await listAccessibleBranches(ctx);

  const canManageBranches = ctx.permissions.has("BRANCH_MANAGE");
  const canManageStaff = ctx.permissions.has("STAFF_MANAGE");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {ctx.organizationName}
          </h1>
          <p className="text-sm text-ink-secondary">
            Signed in as {ctx.name} ({ctx.roleSlug})
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canManageBranches ? (
            <Link
              href="/owner/branches"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:opacity-95"
            >
              <Building2 className="h-4 w-4" aria-hidden="true" />
              <span>Manage Branches</span>
            </Link>
          ) : null}
          {canManageStaff ? (
            <Link
              href="/owner/staff"
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-subtle bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:bg-muted"
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              <span>Manage Team</span>
            </Link>
          ) : null}
        </div>
      </div>

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
        <StatCard
          label="Onboarding Status"
          value="Ready"
          subtitle="Add services & QR in next steps"
          tone="accent"
        />
      </div>

      <section className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink">Salon Onboarding Checklist</h2>
        <ul className="mt-3 space-y-2.5 text-sm text-ink-secondary">
          <li className="flex items-center gap-2.5 text-ink">
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-status-completed-fg"
              aria-hidden="true"
            />
            <span>Salon organization &amp; Main Branch initialized</span>
          </li>
          <li className="flex items-center gap-2.5">
            <Building2
              className="h-4 w-4 shrink-0 text-ink-secondary"
              aria-hidden="true"
            />
            <span>
              Configure 7-day operating hours &amp; stations in{" "}
              <Link href="/owner/branches" className="font-medium text-ink underline">
                Branches
              </Link>
            </span>
          </li>
          <li className="flex items-center gap-2.5">
            <Users className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden="true" />
            <span>
              Invite barbers, receptionists, or managers in{" "}
              <Link href="/owner/staff" className="font-medium text-ink underline">
                Staff &amp; Roles
              </Link>
            </span>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Your Branches</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {branches.map((branch) => (
            <div
              key={branch.id}
              className="rounded-card border border-subtle bg-surface p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-ink">{branch.name}</h3>
                  <p className="font-mono text-xs text-ink-secondary">
                    /salon/.../{branch.slug}
                  </p>
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
              {branch.city ? (
                <p className="mt-2 text-xs text-ink-secondary">{branch.city}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
