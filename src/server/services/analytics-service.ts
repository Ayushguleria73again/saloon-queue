import type {
  AnalyticsGranularity,
  AnalyticsRangePreset,
  AnalyticsReportDto,
  AnalyticsSummaryDto,
  AnalyticsTrendPointDto,
  BranchComparisonDto,
  TopServiceDto,
} from "@/features/analytics/types";
import type { AnalyticsQueryInput } from "@/features/analytics/schemas";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { AuthorizedTenantContext } from "@/server/auth";
import { withTenantDb, type DbClient } from "@/server/db";

interface DateRangeBounds {
  range: AnalyticsRangePreset;
  fromIso: string;
  toIso: string;
  granularity: AnalyticsGranularity;
}

export function computeDateRangeBounds(
  query: AnalyticsQueryInput,
  now: Date = new Date(),
): DateRangeBounds {
  const range = query.range ?? "7d";
  const nowIso = now.toISOString().slice(0, 10);

  if (range === "custom" && query.from && query.to) {
    const fromTime = new Date(`${query.from}T00:00:00.000Z`).getTime();
    const toTime = new Date(`${query.to}T00:00:00.000Z`).getTime();
    const diffDays = Math.max(1, Math.round((toTime - fromTime) / 86_400_000));

    const defaultGranularity: AnalyticsGranularity =
      diffDays > 60 ? "month" : diffDays > 14 ? "week" : "day";

    return {
      range: "custom",
      fromIso: query.from,
      toIso: query.to,
      granularity: query.granularity ?? defaultGranularity,
    };
  }

  if (range === "today") {
    return {
      range: "today",
      fromIso: nowIso,
      toIso: nowIso,
      granularity: "day",
    };
  }

  if (range === "30d") {
    const fromDate = new Date(now.getTime() - 29 * 86_400_000);
    return {
      range: "30d",
      fromIso: fromDate.toISOString().slice(0, 10),
      toIso: nowIso,
      granularity: query.granularity ?? "day",
    };
  }

  if (range === "90d") {
    const fromDate = new Date(now.getTime() - 89 * 86_400_000);
    return {
      range: "90d",
      fromIso: fromDate.toISOString().slice(0, 10),
      toIso: nowIso,
      granularity: query.granularity ?? "week",
    };
  }

  // Default: 7d
  const fromDate = new Date(now.getTime() - 6 * 86_400_000);
  return {
    range: "7d",
    fromIso: fromDate.toISOString().slice(0, 10),
    toIso: nowIso,
    granularity: query.granularity ?? "day",
  };
}

function formatPeriodLabel(periodKey: string, granularity: AnalyticsGranularity): string {
  if (granularity === "day") {
    const [year, month, day] = periodKey.split("-");
    if (!year || !month || !day) return periodKey;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  if (granularity === "week") {
    return `Wk of ${periodKey}`;
  }

  if (granularity === "month") {
    const [year, month] = periodKey.split("-");
    if (!year || !month) return periodKey;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  return periodKey;
}

/**
 * Returns tenant-scoped operational analytics with indexed SQL aggregations.
 * Strictly respects composite tenant boundaries (`organizationId`) and staff branch access.
 */
export async function getTenantAnalytics(
  ctx: AuthorizedTenantContext,
  query: AnalyticsQueryInput,
  options?: {
    now?: Date;
    client?: DbClient;
  },
): Promise<AnalyticsReportDto> {
  const bounds = computeDateRangeBounds(query, options?.now);

  return withTenantDb(
    ctx.organizationId,
    async (tx) => {
      // 1. Resolve permitted branch IDs for the active user
      let permittedBranchIds: string[] = [];

      if (ctx.allBranches) {
        const allOrgBranches = await tx.branch.findMany({
          where: { organizationId: ctx.organizationId },
          select: { id: true },
        });
        permittedBranchIds = allOrgBranches.map((b) => b.id);
      } else {
        permittedBranchIds = Array.from(ctx.allowedBranchIds);
      }

      // If a specific branch is selected, enforce strict access
      let filterBranchIds: string[] = [];
      if (query.branchId) {
        if (!permittedBranchIds.includes(query.branchId)) {
          if (ctx.allBranches) {
            throw new NotFoundError("Branch was not found in this organization.");
          }
          throw new ForbiddenError(
            "BRANCH_ACCESS_DENIED",
            "You do not have permission to view analytics for this branch.",
          );
        }
        filterBranchIds = [query.branchId];
      } else {
        filterBranchIds = permittedBranchIds;
      }

      // If user has zero permitted branches, return empty report
      if (filterBranchIds.length === 0) {
        return {
          range: bounds.range,
          dateFrom: bounds.fromIso,
          dateTo: bounds.toIso,
          granularity: bounds.granularity,
          selectedBranchId: query.branchId ?? null,
          summary: {
            totalTokens: 0,
            completedTokens: 0,
            cancelledTokens: 0,
            noShowTokens: 0,
            skippedTokens: 0,
            servingOrWaitingTokens: 0,
            completionRate: 0,
            averageWaitMinutes: 0,
            averageServiceDurationMinutes: 0,
            totalRevenuePaise: 0,
            walkInTokensCount: 0,
            qrTokensCount: 0,
          },
          trends: [],
          topServices: [],
          branches: [],
        };
      }

      // 2. Query Summary KPIs in a single SQL aggregation pass
      const summaryResult = await tx.$queryRaw<
        Array<{
          total_tokens: bigint;
          completed_tokens: bigint;
          cancelled_tokens: bigint;
          no_show_tokens: bigint;
          skipped_tokens: bigint;
          serving_or_waiting_tokens: bigint;
          walk_in_tokens_count: bigint;
          qr_tokens_count: bigint;
          avg_wait_minutes: number | null;
          avg_service_minutes: number | null;
          total_revenue_paise: bigint;
        }>
      >`
        SELECT
          COUNT(*)::bigint AS "total_tokens",
          COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::bigint AS "completed_tokens",
          COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::bigint AS "cancelled_tokens",
          COUNT(*) FILTER (WHERE "status" = 'NO_SHOW')::bigint AS "no_show_tokens",
          COUNT(*) FILTER (WHERE "status" = 'SKIPPED')::bigint AS "skipped_tokens",
          COUNT(*) FILTER (WHERE "status" IN ('WAITING', 'CALLED', 'IN_SERVICE'))::bigint AS "serving_or_waiting_tokens",
          COUNT(*) FILTER (WHERE "source" = 'WALK_IN')::bigint AS "walk_in_tokens_count",
          COUNT(*) FILTER (WHERE "source" = 'QR')::bigint AS "qr_tokens_count",
          AVG(EXTRACT(EPOCH FROM (COALESCE("service_started_at", "called_at") - "created_at")) / 60.0)
            FILTER (WHERE COALESCE("service_started_at", "called_at") IS NOT NULL) AS "avg_wait_minutes",
          AVG(EXTRACT(EPOCH FROM ("completed_at" - "service_started_at")) / 60.0)
            FILTER (WHERE "completed_at" IS NOT NULL AND "service_started_at" IS NOT NULL) AS "avg_service_minutes",
          COALESCE(SUM("total_price_in_paise") FILTER (WHERE "status" = 'COMPLETED'), 0)::bigint AS "total_revenue_paise"
        FROM "tokens"
        WHERE "organization_id" = ${ctx.organizationId}::uuid
          AND "branch_id" = ANY(${filterBranchIds}::uuid[])
          AND "business_date" >= ${bounds.fromIso}::date
          AND "business_date" <= ${bounds.toIso}::date
      `;

      const summaryRow = summaryResult[0];
      const totalTokens = Number(summaryRow?.total_tokens ?? 0n);
      const completedTokens = Number(summaryRow?.completed_tokens ?? 0n);
      const cancelledTokens = Number(summaryRow?.cancelled_tokens ?? 0n);
      const noShowTokens = Number(summaryRow?.no_show_tokens ?? 0n);
      const skippedTokens = Number(summaryRow?.skipped_tokens ?? 0n);
      const servingOrWaitingTokens = Number(summaryRow?.serving_or_waiting_tokens ?? 0n);
      const walkInTokensCount = Number(summaryRow?.walk_in_tokens_count ?? 0n);
      const qrTokensCount = Number(summaryRow?.qr_tokens_count ?? 0n);
      const avgWaitMinutes = summaryRow?.avg_wait_minutes
        ? Math.round(Number(summaryRow.avg_wait_minutes) * 10) / 10
        : 0;
      const avgServiceDurationMinutes = summaryRow?.avg_service_minutes
        ? Math.round(Number(summaryRow.avg_service_minutes) * 10) / 10
        : 0;
      const totalRevenuePaise = Number(summaryRow?.total_revenue_paise ?? 0n);
      const completionRate =
        totalTokens > 0 ? Math.round((completedTokens / totalTokens) * 1000) / 10 : 0;

      const summary: AnalyticsSummaryDto = {
        totalTokens,
        completedTokens,
        cancelledTokens,
        noShowTokens,
        skippedTokens,
        servingOrWaitingTokens,
        completionRate,
        averageWaitMinutes: avgWaitMinutes,
        averageServiceDurationMinutes: avgServiceDurationMinutes,
        totalRevenuePaise,
        walkInTokensCount,
        qrTokensCount,
      };

      // 3. Query Trend series bucketed by day, week, or month
      const trendResult =
        bounds.granularity === "day"
          ? await tx.$queryRaw<
              Array<{
                period_key: string;
                total_tokens: bigint;
                completed_tokens: bigint;
                cancelled_tokens: bigint;
                no_show_tokens: bigint;
                avg_wait_minutes: number | null;
                avg_service_minutes: number | null;
                total_revenue_paise: bigint;
              }>
            >`
              SELECT
                to_char("business_date", 'YYYY-MM-DD') AS "period_key",
                COUNT(*)::bigint AS "total_tokens",
                COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::bigint AS "completed_tokens",
                COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::bigint AS "cancelled_tokens",
                COUNT(*) FILTER (WHERE "status" = 'NO_SHOW')::bigint AS "no_show_tokens",
                AVG(EXTRACT(EPOCH FROM (COALESCE("service_started_at", "called_at") - "created_at")) / 60.0)
                  FILTER (WHERE COALESCE("service_started_at", "called_at") IS NOT NULL) AS "avg_wait_minutes",
                AVG(EXTRACT(EPOCH FROM ("completed_at" - "service_started_at")) / 60.0)
                  FILTER (WHERE "completed_at" IS NOT NULL AND "service_started_at" IS NOT NULL) AS "avg_service_minutes",
                COALESCE(SUM("total_price_in_paise") FILTER (WHERE "status" = 'COMPLETED'), 0)::bigint AS "total_revenue_paise"
              FROM "tokens"
              WHERE "organization_id" = ${ctx.organizationId}::uuid
                AND "branch_id" = ANY(${filterBranchIds}::uuid[])
                AND "business_date" >= ${bounds.fromIso}::date
                AND "business_date" <= ${bounds.toIso}::date
              GROUP BY "period_key"
              ORDER BY "period_key" ASC
            `
          : bounds.granularity === "week"
            ? await tx.$queryRaw<
                Array<{
                  period_key: string;
                  total_tokens: bigint;
                  completed_tokens: bigint;
                  cancelled_tokens: bigint;
                  no_show_tokens: bigint;
                  avg_wait_minutes: number | null;
                  avg_service_minutes: number | null;
                  total_revenue_paise: bigint;
                }>
              >`
                SELECT
                  to_char(DATE_TRUNC('week', "business_date"), 'YYYY-MM-DD') AS "period_key",
                  COUNT(*)::bigint AS "total_tokens",
                  COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::bigint AS "completed_tokens",
                  COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::bigint AS "cancelled_tokens",
                  COUNT(*) FILTER (WHERE "status" = 'NO_SHOW')::bigint AS "no_show_tokens",
                  AVG(EXTRACT(EPOCH FROM (COALESCE("service_started_at", "called_at") - "created_at")) / 60.0)
                    FILTER (WHERE COALESCE("service_started_at", "called_at") IS NOT NULL) AS "avg_wait_minutes",
                  AVG(EXTRACT(EPOCH FROM ("completed_at" - "service_started_at")) / 60.0)
                    FILTER (WHERE "completed_at" IS NOT NULL AND "service_started_at" IS NOT NULL) AS "avg_service_minutes",
                  COALESCE(SUM("total_price_in_paise") FILTER (WHERE "status" = 'COMPLETED'), 0)::bigint AS "total_revenue_paise"
                FROM "tokens"
                WHERE "organization_id" = ${ctx.organizationId}::uuid
                  AND "branch_id" = ANY(${filterBranchIds}::uuid[])
                  AND "business_date" >= ${bounds.fromIso}::date
                  AND "business_date" <= ${bounds.toIso}::date
                GROUP BY "period_key"
                ORDER BY "period_key" ASC
              `
            : await tx.$queryRaw<
                Array<{
                  period_key: string;
                  total_tokens: bigint;
                  completed_tokens: bigint;
                  cancelled_tokens: bigint;
                  no_show_tokens: bigint;
                  avg_wait_minutes: number | null;
                  avg_service_minutes: number | null;
                  total_revenue_paise: bigint;
                }>
              >`
                SELECT
                  to_char(DATE_TRUNC('month', "business_date"), 'YYYY-MM') AS "period_key",
                  COUNT(*)::bigint AS "total_tokens",
                  COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::bigint AS "completed_tokens",
                  COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::bigint AS "cancelled_tokens",
                  COUNT(*) FILTER (WHERE "status" = 'NO_SHOW')::bigint AS "no_show_tokens",
                  AVG(EXTRACT(EPOCH FROM (COALESCE("service_started_at", "called_at") - "created_at")) / 60.0)
                    FILTER (WHERE COALESCE("service_started_at", "called_at") IS NOT NULL) AS "avg_wait_minutes",
                  AVG(EXTRACT(EPOCH FROM ("completed_at" - "service_started_at")) / 60.0)
                    FILTER (WHERE "completed_at" IS NOT NULL AND "service_started_at" IS NOT NULL) AS "avg_service_minutes",
                  COALESCE(SUM("total_price_in_paise") FILTER (WHERE "status" = 'COMPLETED'), 0)::bigint AS "total_revenue_paise"
                FROM "tokens"
                WHERE "organization_id" = ${ctx.organizationId}::uuid
                  AND "branch_id" = ANY(${filterBranchIds}::uuid[])
                  AND "business_date" >= ${bounds.fromIso}::date
                  AND "business_date" <= ${bounds.toIso}::date
                GROUP BY "period_key"
                ORDER BY "period_key" ASC
              `;

      const trends: AnalyticsTrendPointDto[] = trendResult.map((row) => ({
        periodKey: row.period_key,
        label: formatPeriodLabel(row.period_key, bounds.granularity),
        totalTokens: Number(row.total_tokens),
        completedTokens: Number(row.completed_tokens),
        cancelledTokens: Number(row.cancelled_tokens),
        noShowTokens: Number(row.no_show_tokens),
        averageWaitMinutes: row.avg_wait_minutes
          ? Math.round(Number(row.avg_wait_minutes) * 10) / 10
          : 0,
        averageServiceDurationMinutes: row.avg_service_minutes
          ? Math.round(Number(row.avg_service_minutes) * 10) / 10
          : 0,
        totalRevenuePaise: Number(row.total_revenue_paise),
      }));

      // 4. Query Top Requested Services (by token count and revenue)
      const topServicesResult = await tx.$queryRaw<
        Array<{
          service_id: string;
          service_name: string;
          token_count: bigint;
          total_revenue_paise: bigint;
          avg_duration_minutes: number | null;
        }>
      >`
        SELECT
          ts."service_id"::text AS "service_id",
          ts."service_name_snapshot" AS "service_name",
          COUNT(*)::bigint AS "token_count",
          COALESCE(SUM(ts."price_in_paise_snapshot"), 0)::bigint AS "total_revenue_paise",
          COALESCE(AVG(ts."duration_minutes_snapshot"), 0)::numeric AS "avg_duration_minutes"
        FROM "token_services" ts
        JOIN "tokens" t ON t."id" = ts."token_id" AND t."organization_id" = ts."organization_id"
        WHERE t."organization_id" = ${ctx.organizationId}::uuid
          AND t."branch_id" = ANY(${filterBranchIds}::uuid[])
          AND t."business_date" >= ${bounds.fromIso}::date
          AND t."business_date" <= ${bounds.toIso}::date
        GROUP BY ts."service_id", ts."service_name_snapshot"
        ORDER BY "token_count" DESC, "total_revenue_paise" DESC
        LIMIT 10
      `;

      const totalServiceRequests = topServicesResult.reduce(
        (acc, row) => acc + Number(row.token_count),
        0,
      );

      const topServices: TopServiceDto[] = topServicesResult.map((row) => {
        const count = Number(row.token_count);
        return {
          serviceId: row.service_id,
          serviceName: row.service_name,
          tokenCount: count,
          totalRevenuePaise: Number(row.total_revenue_paise),
          averageDurationMinutes: row.avg_duration_minutes
            ? Math.round(Number(row.avg_duration_minutes) * 10) / 10
            : 0,
          percentageOfTotal:
            totalServiceRequests > 0
              ? Math.round((count / totalServiceRequests) * 1000) / 10
              : 0,
        };
      });

      // 5. Query Multi-Branch Comparison
      const branchesResult = await tx.$queryRaw<
        Array<{
          branch_id: string;
          branch_name: string;
          branch_slug: string;
          is_active: boolean;
          total_tokens: bigint;
          completed_tokens: bigint;
          cancelled_tokens: bigint;
          no_show_tokens: bigint;
          avg_wait_minutes: number | null;
          avg_service_minutes: number | null;
          total_revenue_paise: bigint;
        }>
      >`
        SELECT
          b."id"::text AS "branch_id",
          b."name" AS "branch_name",
          b."slug" AS "branch_slug",
          b."is_active" AS "is_active",
          COUNT(t."id")::bigint AS "total_tokens",
          COUNT(t."id") FILTER (WHERE t."status" = 'COMPLETED')::bigint AS "completed_tokens",
          COUNT(t."id") FILTER (WHERE t."status" = 'CANCELLED')::bigint AS "cancelled_tokens",
          COUNT(t."id") FILTER (WHERE t."status" = 'NO_SHOW')::bigint AS "no_show_tokens",
          AVG(EXTRACT(EPOCH FROM (COALESCE(t."service_started_at", t."called_at") - t."created_at")) / 60.0)
            FILTER (WHERE COALESCE(t."service_started_at", t."called_at") IS NOT NULL) AS "avg_wait_minutes",
          AVG(EXTRACT(EPOCH FROM (t."completed_at" - t."service_started_at")) / 60.0)
            FILTER (WHERE t."completed_at" IS NOT NULL AND t."service_started_at" IS NOT NULL) AS "avg_service_minutes",
          COALESCE(SUM(t."total_price_in_paise") FILTER (WHERE t."status" = 'COMPLETED'), 0)::bigint AS "total_revenue_paise"
        FROM "branches" b
        LEFT JOIN "tokens" t ON t."branch_id" = b."id"
          AND t."organization_id" = b."organization_id"
          AND t."business_date" >= ${bounds.fromIso}::date
          AND t."business_date" <= ${bounds.toIso}::date
        WHERE b."organization_id" = ${ctx.organizationId}::uuid
          AND b."id" = ANY(${filterBranchIds}::uuid[])
        GROUP BY b."id", b."name", b."slug", b."is_active"
        ORDER BY b."name" ASC
      `;

      const branches: BranchComparisonDto[] = branchesResult.map((row) => {
        const branchTotal = Number(row.total_tokens);
        const branchCompleted = Number(row.completed_tokens);
        return {
          branchId: row.branch_id,
          branchName: row.branch_name,
          branchSlug: row.branch_slug,
          isActive: row.is_active,
          totalTokens: branchTotal,
          completedTokens: branchCompleted,
          cancelledTokens: Number(row.cancelled_tokens),
          noShowTokens: Number(row.no_show_tokens),
          completionRate:
            branchTotal > 0 ? Math.round((branchCompleted / branchTotal) * 1000) / 10 : 0,
          averageWaitMinutes: row.avg_wait_minutes
            ? Math.round(Number(row.avg_wait_minutes) * 10) / 10
            : 0,
          averageServiceDurationMinutes: row.avg_service_minutes
            ? Math.round(Number(row.avg_service_minutes) * 10) / 10
            : 0,
          totalRevenuePaise: Number(row.total_revenue_paise),
        };
      });

      return {
        range: bounds.range,
        dateFrom: bounds.fromIso,
        dateTo: bounds.toIso,
        granularity: bounds.granularity,
        selectedBranchId: query.branchId ?? null,
        summary,
        trends,
        topServices,
        branches,
      };
    },
    options?.client,
  );
}
