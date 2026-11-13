"use client";

import { useId, useState } from "react";
import {
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { Button, Input, useToast } from "@/components/ui";
import type {
  AdminJobItemDto,
  AdminJobListResponseDto,
  OutboxEventStatusType,
} from "@/features/admin/types";

interface BackgroundJobsViewProps {
  initialData: AdminJobListResponseDto;
}

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: "ALL", label: "All Events" },
  { id: "DEAD_LETTER", label: "Dead-Letter" },
  { id: "RETRYING", label: "Retrying" },
  { id: "PENDING", label: "Pending" },
  { id: "PROCESSING", label: "Processing" },
  { id: "PROCESSED", label: "Processed" },
];

export function BackgroundJobsView({ initialData }: BackgroundJobsViewProps) {
  const { showToast } = useToast();
  const searchInputId = useId();

  const [jobs, setJobs] = useState<AdminJobItemDto[]>(initialData.items);
  const [totalCount, setTotalCount] = useState(initialData.totalCount);
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [retryingEventId, setRetryingEventId] = useState<string | null>(null);

  async function fetchJobs(params: { status?: string; q?: string }) {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (params.status && params.status !== "ALL") {
        qs.set("status", params.status);
      }
      if (params.q?.trim()) {
        qs.set("q", params.q.trim());
      }

      const res = await fetch(`/api/admin/jobs?${qs.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to load background jobs.");
      }

      const data = (await res.json()) as AdminJobListResponseDto;
      setJobs(data.items);
      setTotalCount(data.totalCount);
    } catch (err) {
      showToast({
        title: "Load Error",
        description:
          err instanceof Error ? err.message : "Unable to retrieve job events.",
        variant: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleFilterChange(status: string) {
    setSelectedStatus(status);
    void fetchJobs({ status, q: searchQuery });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    void fetchJobs({ status: selectedStatus, q: searchQuery });
  }

  async function handleRetryEvent(eventId: string) {
    setRetryingEventId(eventId);
    try {
      const res = await fetch(`/api/admin/jobs/${eventId}/retry`, {
        method: "POST",
      });

      if (!res.ok) {
        const errorJson = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorJson.error?.message ?? "Failed to retry job event.");
      }

      setJobs((prev) =>
        prev.map((j) =>
          j.id === eventId
            ? {
                ...j,
                status: "PENDING" as OutboxEventStatusType,
                attemptCount: 0,
                lastError: null,
              }
            : j,
        ),
      );

      showToast({
        title: "Event Re-queued",
        description: "Background worker has been nudged for immediate dispatch.",
        variant: "success",
      });
    } catch (err) {
      showToast({
        title: "Retry Failed",
        description:
          err instanceof Error ? err.message : "Unable to re-queue event.",
        variant: "error",
      });
    } finally {
      setRetryingEventId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
          Background Job Backlog
        </h1>
        <p className="mt-1 text-xs text-ink-secondary sm:text-sm">
          Transactional outbox delivery logs, worker retry cycles, and dead-letter events ({totalCount} total).
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-card border border-subtle bg-surface p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        {/* Status filter tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const isActive = selectedStatus === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => handleFilterChange(f.id)}
                className={`rounded-button px-3 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? "bg-brand-primary text-brand-primary-fg shadow-sm"
                    : "bg-surface-elevated text-ink-secondary hover:text-ink hover:bg-surface-elevated/80"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Search input form */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-secondary" />
            <label htmlFor={searchInputId} className="sr-only">
              Search by event type or organization
            </label>
            <Input
              id={searchInputId}
              type="search"
              placeholder="Search event type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 py-1.5 text-xs"
            />
          </div>
          <Button type="submit" size="sm" disabled={isLoading} className="text-xs">
            Search
          </Button>
        </form>
      </div>

      {/* Jobs Table */}
      <div className="rounded-card border border-subtle bg-surface p-4 shadow-sm">
        {jobs.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-card border border-dashed border-subtle bg-surface-elevated/40 text-center text-xs text-ink-secondary">
            <Wrench className="mb-2 h-8 w-8 opacity-40" />
            <p>No outbox events match the selected filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-subtle text-ink-secondary">
                  <th className="pb-2.5 font-medium">Event Type</th>
                  <th className="pb-2.5 font-medium">Organization / Branch</th>
                  <th className="pb-2.5 font-medium">Status</th>
                  <th className="pb-2.5 text-right font-medium">Attempts</th>
                  <th className="pb-2.5 font-medium">Last Error</th>
                  <th className="pb-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-surface-elevated/40">
                    <td className="py-3 font-mono">
                      <span className="font-semibold text-ink">{job.eventType}</span>
                      <p className="text-[10px] text-ink-secondary">
                        {job.createdAt.slice(0, 19).replace("T", " ")}
                      </p>
                    </td>
                    <td className="py-3">
                      <span className="font-medium text-ink">{job.organizationName}</span>
                      {job.branchName && (
                        <p className="text-[11px] text-ink-secondary">{job.branchName}</p>
                      )}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          job.status === "PROCESSED"
                            ? "bg-status-active-bg text-status-active-fg"
                            : job.status === "DEAD_LETTER"
                              ? "bg-status-cancelled-bg text-status-cancelled-fg"
                              : job.status === "RETRYING"
                                ? "bg-status-waiting-bg text-status-waiting-fg"
                                : "bg-surface-elevated text-ink-secondary"
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-ink">
                      {job.attemptCount} / {job.maxAttempts}
                    </td>
                    <td className="py-3 max-w-xs truncate text-[11px] text-ink-secondary">
                      {job.lastError ?? "—"}
                    </td>
                    <td className="py-3 text-right">
                      {job.status === "DEAD_LETTER" || job.status === "RETRYING" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRetryEvent(job.id)}
                          disabled={retryingEventId === job.id}
                          className="gap-1 text-xs text-brand-primary hover:bg-brand-primary/10"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${
                              retryingEventId === job.id ? "animate-spin" : ""
                            }`}
                          />
                          <span>Retry</span>
                        </Button>
                      ) : (
                        <span className="text-[11px] text-ink-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
