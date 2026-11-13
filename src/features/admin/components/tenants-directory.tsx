"use client";

import { useId, useState } from "react";
import {
  Building,
  Lock,
  Search,
  Unlock,
} from "lucide-react";
import {
  Button,
  Input,
  useToast,
} from "@/components/ui";
import type {
  AdminTenantItemDto,
  AdminTenantListResponseDto,
  OrganizationStatusType,
} from "@/features/admin/types";

interface TenantsDirectoryProps {
  initialData: AdminTenantListResponseDto;
}

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: "ALL", label: "All Tenants" },
  { id: "ACTIVE", label: "Active" },
  { id: "SUSPENDED", label: "Suspended" },
  { id: "PENDING", label: "Pending" },
  { id: "DEACTIVATED", label: "Deactivated" },
];

export function TenantsDirectory({ initialData }: TenantsDirectoryProps) {
  const { showToast } = useToast();
  const searchInputId = useId();

  const [tenants, setTenants] = useState<AdminTenantItemDto[]>(initialData.items);
  const [totalCount, setTotalCount] = useState(initialData.totalCount);
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Modal state for Activate / Suspend action
  const [modalTenant, setModalTenant] = useState<AdminTenantItemDto | null>(null);
  const [targetStatus, setTargetStatus] = useState<OrganizationStatusType>("SUSPENDED");
  const [statusReason, setStatusReason] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  async function fetchTenants(params: { status?: string; q?: string }) {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (params.status && params.status !== "ALL") {
        qs.set("status", params.status);
      }
      if (params.q?.trim()) {
        qs.set("q", params.q.trim());
      }

      const res = await fetch(`/api/admin/tenants?${qs.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to load tenants list.");
      }

      const data = (await res.json()) as AdminTenantListResponseDto;
      setTenants(data.items);
      setTotalCount(data.totalCount);
    } catch (err) {
      showToast({
        title: "Load Error",
        description:
          err instanceof Error ? err.message : "Unable to retrieve organizations.",
        variant: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleFilterChange(status: string) {
    setSelectedStatus(status);
    void fetchTenants({ status, q: searchQuery });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    void fetchTenants({ status: selectedStatus, q: searchQuery });
  }

  function openStatusModal(tenant: AdminTenantItemDto, nextStatus: OrganizationStatusType) {
    setModalTenant(tenant);
    setTargetStatus(nextStatus);
    setStatusReason(
      nextStatus === "SUSPENDED"
        ? "Account suspended by platform administrator for review."
        : "Account reactivated by platform administrator.",
    );
  }

  async function handleConfirmStatusChange() {
    if (!modalTenant) return;
    if (statusReason.trim().length < 3) {
      showToast({
        title: "Reason Required",
        description: "Please specify a reason (at least 3 characters).",
        variant: "info",
      });
      return;
    }

    setIsUpdating(true);
    try {
      const res = await fetch(`/api/admin/tenants/${modalTenant.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
          reason: statusReason.trim(),
        }),
      });

      if (!res.ok) {
        const errorJson = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorJson.error?.message ?? "Failed to update tenant status.");
      }

      const updated = (await res.json()) as AdminTenantItemDto;

      setTenants((prev) =>
        prev.map((t) => (t.id === updated.id ? { ...t, status: updated.status } : t)),
      );

      showToast({
        title: "Tenant Status Updated",
        description: `${modalTenant.name} is now ${targetStatus}.`,
        variant: "success",
      });

      setModalTenant(null);
    } catch (err) {
      showToast({
        title: "Update Failed",
        description:
          err instanceof Error ? err.message : "Unable to change tenant status.",
        variant: "error",
      });
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
          Tenants Directory
        </h1>
        <p className="mt-1 text-xs text-ink-secondary sm:text-sm">
          Platform-wide salon organizations, branch capacity, and status controls ({totalCount} total).
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
              Search by salon name or slug
            </label>
            <Input
              id={searchInputId}
              type="search"
              placeholder="Search salon or slug..."
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

      {/* Tenants Table */}
      <div className="rounded-card border border-subtle bg-surface p-4 shadow-sm">
        {tenants.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-card border border-dashed border-subtle bg-surface-elevated/40 text-center text-xs text-ink-secondary">
            <Building className="mb-2 h-8 w-8 opacity-40" />
            <p>No organizations match the selected filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-subtle text-ink-secondary">
                  <th className="pb-2.5 font-medium">Organization</th>
                  <th className="pb-2.5 font-medium">Owner</th>
                  <th className="pb-2.5 font-medium">Status</th>
                  <th className="pb-2.5 text-right font-medium">Branches</th>
                  <th className="pb-2.5 text-right font-medium">Staff</th>
                  <th className="pb-2.5 text-right font-medium">30d Tokens</th>
                  <th className="pb-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-elevated/40">
                    <td className="py-3">
                      <div>
                        <span className="font-semibold text-ink">{t.name}</span>
                        <p className="font-mono text-[11px] text-ink-secondary">
                          /salon/{t.slug}
                        </p>
                      </div>
                    </td>
                    <td className="py-3">
                      <div>
                        <span className="text-ink">{t.ownerName ?? "—"}</span>
                        <p className="text-[11px] text-ink-secondary">{t.ownerEmail ?? "—"}</p>
                      </div>
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          t.status === "ACTIVE"
                            ? "bg-status-active-bg text-status-active-fg"
                            : t.status === "SUSPENDED"
                              ? "bg-status-cancelled-bg text-status-cancelled-fg"
                              : "bg-status-waiting-bg text-status-waiting-fg"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-ink">
                      {t.branchCount}
                    </td>
                    <td className="py-3 text-right font-mono text-ink">
                      {t.memberCount}
                    </td>
                    <td className="py-3 text-right font-mono font-bold text-ink">
                      {t.thirtyDayTokenCount}
                    </td>
                    <td className="py-3 text-right">
                      {t.status === "ACTIVE" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openStatusModal(t, "SUSPENDED")}
                          className="gap-1 text-xs text-status-cancelled-fg hover:bg-status-cancelled-bg"
                        >
                          <Lock className="h-3 w-3" />
                          <span>Suspend</span>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openStatusModal(t, "ACTIVE")}
                          className="gap-1 text-xs text-status-active-fg hover:bg-status-active-bg"
                        >
                          <Unlock className="h-3 w-3" />
                          <span>Activate</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Status Toggle Confirmation Modal */}
      {modalTenant && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => !isUpdating && setModalTenant(null)}
          />
          <div className="relative w-full max-w-md rounded-card border border-subtle bg-surface p-6 shadow-xl">
            <h3 className="text-base font-bold text-ink">
              {targetStatus === "SUSPENDED"
                ? `Suspend ${modalTenant.name}?`
                : `Reactivate ${modalTenant.name}?`}
            </h3>
            <p className="mt-1.5 text-xs text-ink-secondary">
              {targetStatus === "SUSPENDED"
                ? "Suspending this salon will immediately halt customer QR intakes and block all owner and staff dashboard operations across all its branches."
                : "Reactivating this salon will restore normal QR intake and owner access across all branches."}
            </p>

            <div className="mt-4 space-y-1.5 text-left">
              <label className="block text-xs font-medium text-ink-secondary">
                Operational Reason (Required)
              </label>
              <Input
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="e.g. Delinquent billing or terms violation"
                className="text-xs"
                disabled={isUpdating}
              />
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setModalTenant(null)}
                disabled={isUpdating}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant={targetStatus === "SUSPENDED" ? "danger" : "primary"}
                onClick={handleConfirmStatusChange}
                disabled={isUpdating || statusReason.trim().length < 3}
                className="text-xs"
              >
                {isUpdating
                  ? "Updating..."
                  : targetStatus === "SUSPENDED"
                    ? "Suspend Organization"
                    : "Reactivate Organization"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
