"use client";

import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { BranchSwitcher, Button, ConfirmModal, Input, useToast } from "@/components/ui";
import { createServiceSchema } from "@/features/services/schemas";
import { formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";

export interface BranchOverrideView {
  branchId: string;
  isAvailable: boolean;
  priceOverrideInPaise: number | null;
  durationOverrideMinutes: number | null;
  sortOrder: number;
}

export interface CatalogServiceView {
  id: string;
  name: string;
  description: string | null;
  basePriceInPaise: number;
  baseDurationMinutes: number;
  isActive: boolean;
  sortOrder: number;
  branchOverrides: BranchOverrideView[];
}

export interface CatalogBranchView {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

export function ServicesManager({
  initialServices,
  branches,
}: {
  initialServices: CatalogServiceView[];
  branches: CatalogBranchView[];
}) {
  const { showToast } = useToast();
  const [services, setServices] = useState<CatalogServiceView[]>(initialServices);
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id ?? "");

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceRupees, setPriceRupees] = useState("250");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [creating, setCreating] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<CatalogServiceView | null>(
    null,
  );
  const [updatingServiceId, setUpdatingServiceId] = useState<string | null>(null);

  // Local draft overrides keyed by `${serviceId}:${branchId}`
  const [overrideDrafts, setOverrideDrafts] = useState<
    Record<string, { priceRupees: string; duration: string; isAvailable: boolean }>
  >({});

  async function reloadCatalog() {
    const res = await fetch("/api/owner/services");
    if (res.ok) {
      const json = (await res.json()) as { services: CatalogServiceView[] };
      setServices(json.services);
    }
  }

  async function handleCreateService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const basePriceInPaise = Math.round(Number(priceRupees) * 100);
    const baseDurationMinutes = Math.round(Number(durationMinutes));

    const parsed = createServiceSchema.safeParse({
      name,
      description: description || null,
      basePriceInPaise,
      baseDurationMinutes,
      sortOrder: services.length,
    });

    if (!parsed.success) {
      showToast({
        variant: "error",
        title: "Invalid service inputs",
        description:
          parsed.error.issues[0]?.message ?? "Check service name, price, and duration.",
      });
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/owner/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        showToast({
          variant: "error",
          title: "Could not add service",
          description: json.error?.message,
        });
        return;
      }

      setName("");
      setDescription("");
      setShowCreate(false);
      await reloadCatalog();
      showToast({ variant: "success", title: "Service added to catalog" });
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(service: CatalogServiceView, nextActive: boolean) {
    setUpdatingServiceId(service.id);
    try {
      const res = await fetch(`/api/owner/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });

      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        showToast({
          variant: "error",
          title: "Update failed",
          description: json.error?.message,
        });
        return;
      }

      setDeactivateTarget(null);
      await reloadCatalog();
      showToast({
        variant: "success",
        title: nextActive ? "Service reactivated" : "Service deactivated",
      });
    } finally {
      setUpdatingServiceId(null);
    }
  }

  function getDraftFor(service: CatalogServiceView, branchId: string) {
    const key = `${service.id}:${branchId}`;
    const existingDraft = overrideDrafts[key];
    if (existingDraft) {
      return existingDraft;
    }
    const override = service.branchOverrides.find((o) => o.branchId === branchId);
    return {
      isAvailable: override?.isAvailable ?? false,
      priceRupees:
        override?.priceOverrideInPaise !== null &&
        override?.priceOverrideInPaise !== undefined
          ? String(override.priceOverrideInPaise / 100)
          : "",
      duration:
        override?.durationOverrideMinutes !== null &&
        override?.durationOverrideMinutes !== undefined
          ? String(override.durationOverrideMinutes)
          : "",
    };
  }

  function setDraftFor(
    service: CatalogServiceView,
    branchId: string,
    patch: Partial<{ priceRupees: string; duration: string; isAvailable: boolean }>,
  ) {
    const key = `${service.id}:${branchId}`;
    const current = getDraftFor(service, branchId);
    setOverrideDrafts((prev) => ({
      ...prev,
      [key]: { ...current, ...patch },
    }));
  }

  async function handleSaveBranchOverride(service: CatalogServiceView) {
    if (!selectedBranchId) return;
    const draft = getDraftFor(service, selectedBranchId);

    const priceOverrideInPaise =
      draft.priceRupees.trim() === ""
        ? null
        : Math.round(Number(draft.priceRupees) * 100);
    const durationOverrideMinutes =
      draft.duration.trim() === "" ? null : Math.round(Number(draft.duration));

    setUpdatingServiceId(`${service.id}:${selectedBranchId}`);
    try {
      const res = await fetch(
        `/api/owner/branches/${selectedBranchId}/services/${service.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isAvailable: draft.isAvailable,
            priceOverrideInPaise,
            durationOverrideMinutes,
          }),
        },
      );

      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        showToast({
          variant: "error",
          title: "Override save failed",
          description: json.error?.message,
        });
        return;
      }

      await reloadCatalog();
      showToast({ variant: "success", title: "Branch pricing & availability updated" });
    } finally {
      setUpdatingServiceId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Services &amp; Branch Pricing
          </h1>
          <p className="text-sm text-ink-secondary">
            Manage base salon services and branch-specific availability or price
            overrides.
          </p>
        </div>

        <Button onClick={() => setShowCreate((prev) => !prev)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{showCreate ? "Cancel" : "Add Service"}</span>
        </Button>
      </div>

      {showCreate ? (
        <form
          onSubmit={handleCreateService}
          className="space-y-4 rounded-card border border-subtle bg-surface p-5 shadow-sm"
        >
          <h2 className="text-base font-semibold text-ink">New Organization Service</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Service Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Classic Haircut"
              required
            />
            <Input
              label="Base Price (₹)"
              type="number"
              min={0}
              step="1"
              value={priceRupees}
              onChange={(e) => setPriceRupees(e.target.value)}
              required
            />
            <Input
              label="Duration (minutes)"
              type="number"
              min={1}
              max={600}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              required
            />
          </div>
          <Input
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Precision scissor cut, wash, and styling"
          />
          <Button type="submit" loading={creating}>
            Save Service
          </Button>
        </form>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Catalog &amp; Branch Matrix</h2>
          {branches.length > 0 ? (
            <BranchSwitcher
              branches={branches}
              selectedBranchId={selectedBranchId}
              onChange={setSelectedBranchId}
              label="Branch overrides"
            />
          ) : null}
        </div>

        <div className="space-y-3">
          {services.map((service) => {
            const draft = selectedBranchId
              ? getDraftFor(service, selectedBranchId)
              : null;
            const isSavingOverride =
              updatingServiceId === `${service.id}:${selectedBranchId}`;

            return (
              <div
                key={service.id}
                className="rounded-card border border-subtle bg-surface p-4 shadow-sm sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-muted text-ink">
                      <Sparkles className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-ink">
                          {service.name}
                        </h3>
                        <span
                          className={
                            service.isActive
                              ? "rounded-full bg-status-completed-bg px-2.5 py-0.5 text-xs font-semibold text-status-completed-fg"
                              : "rounded-full bg-status-skipped-bg px-2.5 py-0.5 text-xs font-semibold text-status-skipped-fg"
                          }
                        >
                          {service.isActive ? "Active" : "Deactivated"}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-ink-secondary">
                        Base: {formatPaiseToInr(service.basePriceInPaise)} •{" "}
                        {formatDurationMinutes(service.baseDurationMinutes)}
                      </p>
                      {service.description ? (
                        <p className="mt-1 text-xs text-ink-secondary">
                          {service.description}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    {service.isActive ? (
                      <Button
                        variant="danger"
                        size="sm"
                        loading={updatingServiceId === service.id}
                        onClick={() => setDeactivateTarget(service)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={updatingServiceId === service.id}
                        onClick={() => handleToggleActive(service, true)}
                      >
                        Reactivate
                      </Button>
                    )}
                  </div>
                </div>

                {selectedBranchId && draft ? (
                  <div className="mt-4 grid gap-3 border-t border-subtle pt-4 sm:grid-cols-4 sm:items-end">
                    <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-subtle bg-canvas px-3 text-sm font-medium text-ink">
                      <input
                        type="checkbox"
                        checked={draft.isAvailable}
                        onChange={(e) =>
                          setDraftFor(service, selectedBranchId, {
                            isAvailable: e.target.checked,
                          })
                        }
                      />
                      <span>Available at branch</span>
                    </label>
                    <Input
                      label="Branch Price Override (₹)"
                      type="number"
                      min={0}
                      placeholder={String(service.basePriceInPaise / 100)}
                      value={draft.priceRupees}
                      onChange={(e) =>
                        setDraftFor(service, selectedBranchId, {
                          priceRupees: e.target.value,
                        })
                      }
                    />
                    <Input
                      label="Duration Override (mins)"
                      type="number"
                      min={1}
                      max={600}
                      placeholder={String(service.baseDurationMinutes)}
                      value={draft.duration}
                      onChange={(e) =>
                        setDraftFor(service, selectedBranchId, {
                          duration: e.target.value,
                        })
                      }
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isSavingOverride}
                      onClick={() => handleSaveBranchOverride(service)}
                    >
                      Apply to Branch
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <ConfirmModal
        open={Boolean(deactivateTarget)}
        title="Deactivate Service?"
        description={
          deactivateTarget
            ? `Customers will no longer see "${deactivateTarget.name}" on QR intake pages. Existing historical tokens preserve their original price and duration snapshots.`
            : ""
        }
        confirmLabel="Deactivate Service"
        tone="danger"
        loading={deactivateTarget ? updatingServiceId === deactivateTarget.id : false}
        onConfirm={() => {
          if (deactivateTarget) {
            void handleToggleActive(deactivateTarget, false);
          }
        }}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
