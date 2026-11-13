import { redirect } from "next/navigation";
import { AnalyticsDashboard } from "@/features/analytics/components/analytics-dashboard";
import { analyticsQuerySchema } from "@/features/analytics/schemas";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { getTenantAnalytics } from "@/server/services/analytics-service";
import { listAccessibleBranches } from "@/server/services/branch-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analytics & Reports — SalonFlow",
};

export default async function OwnerAnalyticsPage(props: {
  searchParams: Promise<{
    range?: string;
    branchId?: string;
    from?: string;
    to?: string;
    granularity?: string;
  }>;
}) {
  try {
    const searchParams = await props.searchParams;
    const ctx = await authorizeTenantAction({
      requiredPermission: "ANALYTICS_VIEW",
      ...(searchParams.branchId && searchParams.branchId !== "all"
        ? { branchId: searchParams.branchId }
        : {}),
    });

    const branches = await listAccessibleBranches(ctx);

    const parsedQuery = analyticsQuerySchema.safeParse({
      ...(searchParams.range ? { range: searchParams.range } : {}),
      ...(searchParams.branchId ? { branchId: searchParams.branchId } : {}),
      ...(searchParams.from ? { from: searchParams.from } : {}),
      ...(searchParams.to ? { to: searchParams.to } : {}),
      ...(searchParams.granularity ? { granularity: searchParams.granularity } : {}),
    });

    const report = await getTenantAnalytics(
      ctx,
      parsedQuery.success ? parsedQuery.data : { range: "7d" },
    );

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Analytics & Reports
          </h1>
          <p className="mt-1 text-xs text-ink-secondary sm:text-sm">
            Operational throughput, customer wait times, revenue, and branch comparisons.
          </p>
        </div>

        <AnalyticsDashboard
          initialReport={report}
          branches={branches.map((b) => ({
            id: b.id,
            name: b.name,
            slug: b.slug,
            city: b.city,
            isActive: b.isActive,
          }))}
        />
      </div>
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      redirect("/owner/dashboard?denied=1");
    }
    throw error;
  }
}

