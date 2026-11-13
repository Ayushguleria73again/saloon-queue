"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Building,
  CheckCircle2,
  Clock,
  Database,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  TrendingUp,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button, StatCard, useToast } from "@/components/ui";
import type {
  PlatformHealthDetailsDto,
  PlatformOverviewDto,
} from "@/features/admin/types";

interface AdminOverviewProps {
  initialOverview: PlatformOverviewDto;
  initialHealth: PlatformHealthDetailsDto;
}

export function AdminOverview({
  initialOverview,
  initialHealth,
}: AdminOverviewProps) {
  const { showToast } = useToast();
  const [overview, setOverview] = useState<PlatformOverviewDto>(initialOverview);
  const [health, setHealth] = useState<PlatformHealthDetailsDto>(initialHealth);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refreshData() {
    setIsRefreshing(true);
    try {
      const [overviewRes, healthRes] = await Promise.all([
        fetch("/api/admin/overview"),
        fetch("/api/admin/health/details"),
      ]);

      if (!overviewRes.ok || !healthRes.ok) {
        throw new Error("Failed to refresh platform telemetry.");
      }

      const [newOverview, newHealth] = await Promise.all([
        overviewRes.json() as Promise<PlatformOverviewDto>,
        healthRes.json() as Promise<PlatformHealthDetailsDto>,
      ]);

      setOverview(newOverview);
      setHealth(newHealth);
      showToast({
        title: "Telemetry Refreshed",
        description: "Latest platform statistics loaded successfully.",
        variant: "success",
      });
    } catch (err) {
      showToast({
        title: "Refresh Failed",
        description:
          err instanceof Error ? err.message : "Unable to reach platform telemetry.",
        variant: "error",
      });
    } finally {
      setIsRefreshing(false);
    }
  }

  const hasJobAlerts =
    overview.jobs.deadLetter > 0 || overview.jobs.retrying > 0;

  return (
    <div className="space-y-6">
      {/* Title & Action Strip */}
      <div className="flex flex-col gap-4 rounded-card border border-subtle bg-surface p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Platform Overview
          </h1>
          <p className="mt-1 text-xs text-ink-secondary">
            Multi-tenant SaaS operational health, token throughput, and worker diagnostics.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                health.status === "healthy" ? "bg-status-active-fg" : "bg-status-cancelled-fg"
              }`}
            />
            <span className="capitalize">{health.status}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={refreshData}
            disabled={isRefreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Tenants"
          value={overview.organizations.total}
          subtitle={`${overview.organizations.active} active · ${overview.organizations.suspended} suspended`}
          icon={<Building className="h-4 w-4" />}
          tone="default"
        />

        <StatCard
          label="Active Branches"
          value={overview.branches.active}
          subtitle={`${overview.branches.total} branches provisioned`}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="accent"
        />

        <StatCard
          label="Today's Tokens"
          value={overview.tokens.todayTotal}
          subtitle={`${overview.tokens.todayCompleted} completed · ${overview.tokens.todayServingOrWaiting} in-queue`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="default"
        />

        <StatCard
          label="Outbox Job Health"
          value={overview.jobs.deadLetter > 0 ? `${overview.jobs.deadLetter} Dead-Letter` : "Healthy"}
          subtitle={`${overview.jobs.pending} pending · ${overview.jobs.retrying} retrying`}
          icon={<Wrench className="h-4 w-4" />}
          tone={hasJobAlerts ? "warning" : "default"}
        />
      </div>

      {/* Two-Column Diagnostic & Shortcuts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* System Diagnostics & Infrastructure */}
        <div className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
              System Diagnostics
            </h2>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between rounded-card border border-subtle bg-surface-elevated/40 p-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-ink-secondary" />
                <span className="font-medium text-ink">PostgreSQL Database</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-ink-secondary">
                  {health.database.latencyMs}ms
                </span>
                {health.database.connected ? (
                  <CheckCircle2 className="h-4 w-4 text-status-active-fg" />
                ) : (
                  <XCircle className="h-4 w-4 text-status-cancelled-fg" />
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-card border border-subtle bg-surface-elevated/40 p-3">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-ink-secondary" />
                <span className="font-medium text-ink">Web Push (VAPID)</span>
              </div>
              <div>
                {health.vapidConfigured ? (
                  <span className="inline-flex items-center gap-1 font-medium text-status-active-fg">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Configured
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-status-waiting-fg">
                    <Clock className="h-3.5 w-3.5" />
                    Keys Missing
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-card border border-subtle bg-surface-elevated/40 p-3">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-ink-secondary" />
                <span className="font-medium text-ink">Runtime Engine</span>
              </div>
              <span className="font-mono text-ink-secondary">
                Node {health.nodeVersion} (Up {Math.floor(health.uptimeSeconds / 60)}m)
              </span>
            </div>
          </div>
        </div>

        {/* Operator Controls & Navigation */}
        <div className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
              Operator Quick Actions
            </h2>
          </div>

          <div className="space-y-3">
            <Link
              href="/admin/tenants"
              className="group flex items-center justify-between rounded-card border border-subtle bg-surface-elevated/40 p-3.5 transition hover:border-brand-accent hover:bg-surface-elevated"
            >
              <div>
                <h3 className="text-xs font-semibold text-ink group-hover:text-brand-primary">
                  Tenants Directory
                </h3>
                <p className="mt-0.5 text-[11px] text-ink-secondary">
                  Search salon accounts, inspect branch usage, and toggle suspension.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-ink-secondary group-hover:translate-x-0.5 group-hover:text-brand-primary transition" />
            </Link>

            <Link
              href="/admin/jobs"
              className="group flex items-center justify-between rounded-card border border-subtle bg-surface-elevated/40 p-3.5 transition hover:border-brand-accent hover:bg-surface-elevated"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-ink group-hover:text-brand-primary">
                    Background Job Backlog
                  </h3>
                  {overview.jobs.deadLetter > 0 && (
                    <span className="rounded-full bg-status-cancelled-bg px-2 py-0.5 text-[10px] font-bold text-status-cancelled-fg">
                      {overview.jobs.deadLetter} Failed
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-ink-secondary">
                  Monitor outbox worker delivery queues and re-queue dead-letter events.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-ink-secondary group-hover:translate-x-0.5 group-hover:text-brand-primary transition" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

