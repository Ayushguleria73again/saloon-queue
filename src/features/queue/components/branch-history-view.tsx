"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Search } from "lucide-react";
import {
  BranchSwitcher,
  Button,
  Input,
  StatusBadge,
  useToast,
  type BranchOption,
} from "@/components/ui";
import type { BranchHistoryItemDto, BranchHistoryPageDto } from "@/features/queue/types";
import { formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";

interface BranchHistoryViewProps {
  branches: BranchOption[];
  selectedBranchId: string;
  initialPage: BranchHistoryPageDto;
}

const STATUS_OPTIONS = [
  "ALL",
  "WAITING",
  "CALLED",
  "IN_SERVICE",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export function BranchHistoryView({
  branches,
  selectedBranchId,
  initialPage,
}: BranchHistoryViewProps) {
  const router = useRouter();
  const { showToast } = useToast();

  const [items, setItems] = useState<BranchHistoryItemDto[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);

  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchHistory(cursor?: string | null, append = false) {
    if (!selectedBranchId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status !== "ALL") qs.set("status", status);
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      if (search.trim()) qs.set("search", search.trim());
      if (cursor) qs.set("cursor", cursor);
      qs.set("limit", "25");

      const res = await fetch(
        `/api/owner/branches/${encodeURIComponent(selectedBranchId)}/history?${qs.toString()}`,
        { cache: "no-store" },
      );

      const json = (await res
        .json()
        .catch(() => ({}))) as Partial<BranchHistoryPageDto> & {
        error?: { message?: string };
      };

      if (!res.ok || !Array.isArray(json.items)) {
        showToast({
          variant: "error",
          title: "Could not load history",
          description: json.error?.message,
        });
        return;
      }

      setItems((prev) => (append ? [...prev, ...json.items!] : json.items!));
      setNextCursor(json.nextCursor ?? null);
      setHasMore(Boolean(json.hasMore));
    } finally {
      setLoading(false);
    }
  }

  function handleFilterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void fetchHistory(null, false);
  }

  if (branches.length === 0) {
    return (
      <div className="rounded-card border border-subtle bg-surface p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold text-ink">No Branches Accessible</h1>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Token History</h1>
          <p className="text-sm text-ink-secondary">
            Filterable branch ledger ordered by most recent tickets.
          </p>
        </div>

        {branches.length > 1 ? (
          <div className="min-w-[200px]">
            <BranchSwitcher
              branches={branches}
              selectedBranchId={selectedBranchId}
              onChange={(branchId) =>
                router.push(`/owner/history?branchId=${encodeURIComponent(branchId)}`)
              }
            />
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleFilterSubmit}
        className="grid gap-3 rounded-card border border-subtle bg-surface p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
      >
        <Input
          label="Search"
          placeholder="Token #, name, mobile"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="space-y-1.5">
          <label htmlFor="history-status" className="block text-sm font-medium text-ink">
            Status
          </label>
          <select
            id="history-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}
            className="min-h-12 w-full rounded-control border border-subtle bg-surface px-3 text-base text-ink focus:border-brand-primary focus:outline-none sm:text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === "ALL" ? "All statuses" : opt.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="From Date"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />

        <Input
          label="To Date"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />

        <div className="flex items-end">
          <Button type="submit" variant="primary" loading={loading} className="w-full">
            <Search className="h-4 w-4" aria-hidden="true" />
            Apply Filters
          </Button>
        </div>
      </form>

      <section className="overflow-hidden rounded-card border border-subtle bg-surface shadow-sm">
        {items.length === 0 ? (
          <div className="p-8 text-center">
            <History className="mx-auto h-7 w-7 text-ink-secondary" aria-hidden="true" />
            <p className="mt-2 text-sm text-ink-secondary">
              No tokens matched your current filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-subtle bg-muted/70 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Token</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Services</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-mono font-bold text-ink">
                      {item.tokenNumber}
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary">
                        {item.source === "WALK_IN" ? "Walk-In" : "QR"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{item.customerName}</p>
                      <p className="font-mono text-xs text-ink-secondary">
                        {item.customerMobile}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-secondary">
                      {item.services.map((s) => s.serviceName).join(", ")} (
                      {formatDurationMinutes(item.totalDurationMinutes)})
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-ink">
                      {formatPaiseToInr(item.totalPriceInPaise)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-secondary">
                      {item.businessDate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore ? (
          <div className="border-t border-subtle p-4 text-center">
            <Button
              type="button"
              variant="secondary"
              loading={loading}
              onClick={() => void fetchHistory(nextCursor, true)}
            >
              Load Older Records
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
