"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  IndianRupee,
  RefreshCw,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { Button, Input, StatCard, useToast, type BranchOption } from "@/components/ui";
import type {
  AnalyticsRangePreset,
  AnalyticsReportDto,
} from "@/features/analytics/types";
import { formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";

interface AnalyticsDashboardProps {
  initialReport: AnalyticsReportDto;
  branches: BranchOption[];
}

const RANGE_PRESETS: Array<{ id: AnalyticsRangePreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "90d", label: "90 Days" },
  { id: "custom", label: "Custom" },
];

export function AnalyticsDashboard({ initialReport, branches }: AnalyticsDashboardProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [report, setReport] = useState<AnalyticsReportDto>(initialReport);
  const [selectedRange, setSelectedRange] = useState<AnalyticsRangePreset>(
    initialReport.range,
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    initialReport.selectedBranchId ?? "all",
  );
  const [customFrom, setCustomFrom] = useState(initialReport.dateFrom);
  const [customTo, setCustomTo] = useState(initialReport.dateTo);
  const [isLoading, setIsLoading] = useState(false);

  const branchSelectId = useId();

  async function loadAnalytics(params: {
    range: AnalyticsRangePreset;
    branchId: string;
    from?: string;
    to?: string;
  }) {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("range", params.range);
      if (params.branchId && params.branchId !== "all") {
        qs.set("branchId", params.branchId);
      }
      if (params.range === "custom" && params.from && params.to) {
        qs.set("from", params.from);
        qs.set("to", params.to);
      }

      const res = await fetch(`/api/owner/analytics?${qs.toString()}`);
      if (!res.ok) {
        const errorJson = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorJson.error?.message ?? "Failed to load analytics data.");
      }

      const data = (await res.json()) as AnalyticsReportDto;
      setReport(data);

      startTransition(() => {
        router.replace(`/owner/analytics?${qs.toString()}`, { scroll: false });
      });
    } catch (err) {
      showToast({
        title: "Analytics Error",
        description: err instanceof Error ? err.message : "Unable to retrieve analytics.",
        variant: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleRangeChange(newRange: AnalyticsRangePreset) {
    setSelectedRange(newRange);
    if (newRange !== "custom") {
      void loadAnalytics({ range: newRange, branchId: selectedBranchId });
    }
  }

  function handleBranchChange(newBranchId: string) {
    setSelectedBranchId(newBranchId);
    void loadAnalytics({
      range: selectedRange,
      branchId: newBranchId,
      from: customFrom,
      to: customTo,
    });
  }

  function handleApplyCustomDates() {
    if (!customFrom || !customTo) {
      showToast({
        title: "Invalid Range",
        description: "Please specify both from and to dates.",
        variant: "info",
      });
      return;
    }
    if (customFrom > customTo) {
      showToast({
        title: "Invalid Range",
        description: "'From' date cannot be later than 'To' date.",
        variant: "info",
      });
      return;
    }
    void loadAnalytics({
      range: "custom",
      branchId: selectedBranchId,
      from: customFrom,
      to: customTo,
    });
  }

  // Calculate highest token volume for trend chart scaling
  const maxTrendTokens = Math.max(...report.trends.map((t) => t.totalTokens), 1);

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls Bar */}
      <div className="flex flex-col gap-4 rounded-card border border-subtle bg-surface p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        {/* Left: Range preset pill group */}
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGE_PRESETS.map((p) => {
            const isActive = selectedRange === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleRangeChange(p.id)}
                className={`rounded-button px-3 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? "bg-brand-primary text-brand-primary-fg shadow-sm"
                    : "bg-surface-elevated text-ink-secondary hover:text-ink hover:bg-surface-elevated/80"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Right: Branch Selector and Refresh button */}
        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 1 && (
            <div className="flex items-center gap-1.5">
              <label htmlFor={branchSelectId} className="sr-only">
                Filter by Branch
              </label>
              <select
                id={branchSelectId}
                value={selectedBranchId}
                onChange={(e) => handleBranchChange(e.target.value)}
                className="rounded-input border border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-sm focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
              >
                <option value="all">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              loadAnalytics({
                range: selectedRange,
                branchId: selectedBranchId,
                from: customFrom,
                to: customTo,
              })
            }
            disabled={isLoading || isPending}
            className="gap-1.5 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading || isPending ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Custom Date Pickers (visible when range is 'custom') */}
      {selectedRange === "custom" && (
        <div className="flex flex-wrap items-end gap-3 rounded-card border border-subtle bg-surface p-4 shadow-sm">
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-ink-secondary">
              From Date
            </label>
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="py-1 text-xs"
            />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-ink-secondary">
              To Date
            </label>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="py-1 text-xs"
            />
          </div>
          <Button
            size="sm"
            onClick={handleApplyCustomDates}
            disabled={isLoading || isPending}
            className="text-xs"
          >
            Apply Range
          </Button>
        </div>
      )}

      {/* Date Range Meta Tag */}
      <div className="flex items-center gap-2 text-xs text-ink-secondary">
        <Calendar className="h-3.5 w-3.5" />
        <span>
          Reporting Period: <strong className="text-ink">{report.dateFrom}</strong> to{" "}
          <strong className="text-ink">{report.dateTo}</strong> (Granularity:{" "}
          <strong className="capitalize text-ink">{report.granularity}</strong>)
        </span>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Tokens"
          value={report.summary.totalTokens}
          subtitle={`${report.summary.walkInTokensCount} walk-in · ${report.summary.qrTokensCount} QR`}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Completed"
          value={report.summary.completedTokens}
          subtitle={`${report.summary.completionRate}% completion rate`}
          icon={<CheckCircle2 className="h-4 w-4 text-brand-primary" />}
          tone="accent"
        />
        <StatCard
          label="Total Revenue"
          value={formatPaiseToInr(report.summary.totalRevenuePaise)}
          subtitle="From completed visits"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <StatCard
          label="Avg Wait Time"
          value={formatDurationMinutes(report.summary.averageWaitMinutes)}
          subtitle="Time to call"
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Avg Service Time"
          value={formatDurationMinutes(report.summary.averageServiceDurationMinutes)}
          subtitle="Actual in-chair duration"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Cancellations"
          value={report.summary.cancelledTokens + report.summary.noShowTokens}
          subtitle={`${report.summary.cancelledTokens} cancel · ${report.summary.noShowTokens} no-show`}
          icon={<XCircle className="h-4 w-4" />}
          tone={
            report.summary.cancelledTokens + report.summary.noShowTokens > 0
              ? "warning"
              : "default"
          }
        />
      </div>

      {/* Trend Volume Chart */}
      <div className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-brand-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
              Token Volume & Completion Trends
            </h2>
          </div>
          <span className="text-xs text-ink-secondary">
            {report.trends.length} periods
          </span>
        </div>

        {report.trends.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-card border border-dashed border-subtle bg-surface-elevated/40 text-center text-xs text-ink-secondary">
            <BarChart3 className="mb-2 h-8 w-8 opacity-40" />
            <p>No tokens recorded in this time range.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Responsive Visual Bar Grid */}
            <div className="grid grid-flow-col auto-cols-fr items-end gap-1.5 sm:gap-2 h-52 pt-6">
              {report.trends.map((point) => {
                const totalPct = Math.min(
                  100,
                  Math.round((point.totalTokens / maxTrendTokens) * 100),
                );
                const completedPct =
                  point.totalTokens > 0
                    ? Math.round((point.completedTokens / point.totalTokens) * 100)
                    : 0;

                return (
                  <div
                    key={point.periodKey}
                    className="group relative flex h-full flex-col justify-end items-center"
                  >
                    {/* Hover detail tooltip */}
                    <div className="pointer-events-none absolute bottom-full mb-2 hidden w-36 rounded-card border border-subtle bg-surface-elevated p-2 text-left text-[11px] shadow-lg group-hover:block z-10">
                      <p className="font-semibold text-ink">{point.label}</p>
                      <p className="mt-1 text-ink-secondary">
                        Total: <strong className="text-ink">{point.totalTokens}</strong>
                      </p>
                      <p className="text-ink-secondary">
                        Completed:{" "}
                        <strong className="text-brand-primary">
                          {point.completedTokens}
                        </strong>
                      </p>
                      <p className="text-ink-secondary">
                        Avg Wait:{" "}
                        <strong className="text-ink">
                          {formatDurationMinutes(point.averageWaitMinutes)}
                        </strong>
                      </p>
                      <p className="text-ink-secondary">
                        Revenue:{" "}
                        <strong className="text-ink">
                          {formatPaiseToInr(point.totalRevenuePaise)}
                        </strong>
                      </p>
                    </div>

                    {/* Bar visualization */}
                    <div className="w-full max-w-[42px] flex flex-col justify-end h-full">
                      <div
                        style={{ height: `${totalPct}%` }}
                        className="w-full rounded-t relative overflow-hidden bg-surface-elevated transition-all"
                      >
                        {/* Completed portion in brand color */}
                        <div
                          style={{ height: `${completedPct}%` }}
                          className="w-full bg-brand-primary absolute bottom-0 left-0 transition-all"
                        />
                      </div>
                    </div>

                    {/* Axis Label */}
                    <span className="mt-2 text-[10px] text-ink-secondary truncate max-w-full text-center">
                      {point.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Chart Legend */}
            <div className="flex items-center justify-center gap-6 pt-2 border-t border-subtle text-xs text-ink-secondary">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded bg-brand-primary" />
                <span>Completed Tokens</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded bg-surface-elevated border border-subtle" />
                <span>Other / Cancelled / In-Queue</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Two-Column Section: Top Services & Branch Comparison */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Requested Services */}
        <div className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
              Top Requested Services
            </h2>
            <span className="text-xs text-ink-secondary">
              {report.topServices.length} services
            </span>
          </div>

          {report.topServices.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center rounded-card border border-dashed border-subtle bg-surface-elevated/40 text-center text-xs text-ink-secondary">
              <p>No service intake data for this period.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {report.topServices.map((service, index) => (
                <div
                  key={service.serviceId}
                  className="rounded-card border border-subtle bg-surface-elevated/30 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-elevated text-xs font-bold text-ink-secondary">
                        {index + 1}
                      </span>
                      <div>
                        <h3 className="text-xs font-semibold text-ink">
                          {service.serviceName}
                        </h3>
                        <p className="text-[11px] text-ink-secondary">
                          {service.tokenCount} requests · {service.averageDurationMinutes}
                          m avg
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-xs font-bold text-ink">
                        {formatPaiseToInr(service.totalRevenuePaise)}
                      </span>
                      <p className="text-[11px] text-ink-secondary">
                        {service.percentageOfTotal}% of total
                      </p>
                    </div>
                  </div>

                  {/* Relative volume progress bar */}
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated">
                    <div
                      style={{ width: `${service.percentageOfTotal}%` }}
                      className="h-full rounded-full bg-brand-primary"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cross-Branch Performance Comparison */}
        <div className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
              Branch Performance Comparison
            </h2>
            <span className="text-xs text-ink-secondary">
              {report.branches.length} branches
            </span>
          </div>

          {report.branches.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center rounded-card border border-dashed border-subtle bg-surface-elevated/40 text-center text-xs text-ink-secondary">
              <p>No branch data available.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-subtle text-ink-secondary">
                    <th className="pb-2 font-medium">Branch</th>
                    <th className="pb-2 text-right font-medium">Tokens</th>
                    <th className="pb-2 text-right font-medium">Completed</th>
                    <th className="pb-2 text-right font-medium">Avg Wait</th>
                    <th className="pb-2 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {report.branches.map((b) => (
                    <tr key={b.branchId} className="hover:bg-surface-elevated/40">
                      <td className="py-2.5 font-medium text-ink">
                        <div className="flex items-center gap-1.5">
                          <span>{b.branchName}</span>
                          {!b.isActive && (
                            <span className="rounded-full border border-subtle bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-ink-secondary">
                              Inactive
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-mono text-ink">
                        {b.totalTokens}
                      </td>
                      <td className="py-2.5 text-right font-mono text-ink">
                        {b.completedTokens}{" "}
                        <span className="text-[10px] text-ink-secondary">
                          ({b.completionRate}%)
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono text-ink">
                        {formatDurationMinutes(b.averageWaitMinutes)}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-ink">
                        {formatPaiseToInr(b.totalRevenuePaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
