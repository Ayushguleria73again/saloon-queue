"use client";

import { useState } from "react";
import { Building2, Clock, Plus } from "lucide-react";
import { Button, Input, useToast } from "@/components/ui";
import {
  createBranchSchema,
  type BusinessHourEntryInput,
} from "@/features/branches/schemas";
import { toUrlSlug } from "@/features/onboarding/schemas";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface BranchItemView {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  timezone: string;
  isActive: boolean;
  businessHours: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    openTime: string;
    closeTime: string;
  }>;
  settings: {
    tokenPrefix: string;
    activeStationsCount: number;
    allowDuplicateActiveTokens: boolean;
    allowCustomerCancel: boolean;
    enforceBusinessHours: boolean;
    isAcceptingTokens: boolean;
  } | null;
}

export function BranchesManager({
  initialBranches,
}: {
  initialBranches: BranchItemView[];
}) {
  const { showToast } = useToast();
  const [branches, setBranches] = useState<BranchItemView[]>(initialBranches);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [hoursDraft, setHoursDraft] = useState<BusinessHourEntryInput[]>([]);
  const [stationsDraft, setStationsDraft] = useState(1);
  const [allowCancelDraft, setAllowCancelDraft] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function handleCreateBranch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createBranchSchema.safeParse({
      name,
      slug,
      city: city || undefined,
      phone,
      address: address || undefined,
      timezone: "Asia/Kolkata",
    });

    if (!parsed.success) {
      showToast({
        variant: "error",
        title: "Invalid branch details",
        description: "Check branch name, slug, and phone number format.",
      });
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/owner/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const json = (await response.json()) as {
        branch?: BranchItemView;
        error?: { message?: string };
      };

      if (!response.ok || !json.branch) {
        showToast({
          variant: "error",
          title: "Could not create branch",
          description: json.error?.message ?? "Please try again.",
        });
        return;
      }

      setBranches((prev) => [...prev, json.branch!]);
      setName("");
      setSlug("");
      setSlugEdited(false);
      setCity("");
      setPhone("");
      setAddress("");
      setShowCreate(false);
      showToast({ variant: "success", title: "Branch created" });
    } catch {
      showToast({ variant: "error", title: "Network error creating branch" });
    } finally {
      setCreating(false);
    }
  }

  function startEditing(branch: BranchItemView) {
    setEditingBranchId(branch.id);
    setHoursDraft(
      branch.businessHours.map((h) => ({
        dayOfWeek: h.dayOfWeek,
        isOpen: h.isOpen,
        openTime: h.openTime,
        closeTime: h.closeTime,
      })),
    );
    setStationsDraft(branch.settings?.activeStationsCount ?? 1);
    setAllowCancelDraft(branch.settings?.allowCustomerCancel ?? true);
  }

  async function handleToggleActive(branch: BranchItemView) {
    setSavingId(branch.id);
    try {
      const response = await fetch(`/api/owner/branches/${branch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !branch.isActive }),
      });

      const json = (await response.json()) as {
        branch?: BranchItemView;
        error?: { message?: string };
      };

      if (!response.ok || !json.branch) {
        showToast({
          variant: "error",
          title: "Update failed",
          description: json.error?.message,
        });
        return;
      }

      setBranches((prev) => prev.map((b) => (b.id === branch.id ? json.branch! : b)));
      showToast({
        variant: "success",
        title: json.branch.isActive ? "Branch activated" : "Branch deactivated",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveHoursAndSettings(branchId: string) {
    setSavingId(branchId);
    try {
      const response = await fetch(`/api/owner/branches/${branchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessHours: hoursDraft,
          settings: {
            activeStationsCount: stationsDraft,
            allowCustomerCancel: allowCancelDraft,
          },
        }),
      });

      const json = (await response.json()) as {
        branch?: BranchItemView;
        error?: { message?: string };
      };

      if (!response.ok || !json.branch) {
        showToast({
          variant: "error",
          title: "Save failed",
          description: json.error?.message,
        });
        return;
      }

      setBranches((prev) => prev.map((b) => (b.id === branchId ? json.branch! : b)));
      setEditingBranchId(null);
      showToast({ variant: "success", title: "Branch hours & settings saved" });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Branches</h1>
          <p className="text-sm text-ink-secondary">
            Manage locations, operating hours, stations, and branch queue rules.
          </p>
        </div>

        <Button onClick={() => setShowCreate((prev) => !prev)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{showCreate ? "Cancel" : "Add Branch"}</span>
        </Button>
      </div>

      {showCreate ? (
        <form
          onSubmit={handleCreateBranch}
          className="space-y-4 rounded-card border border-subtle bg-surface p-5 shadow-sm"
        >
          <h2 className="text-base font-semibold text-ink">Create New Branch</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Branch Name"
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (!slugEdited) setSlug(toUrlSlug(v));
              }}
              placeholder="Indiranagar"
              required
            />
            <Input
              label="URL Slug"
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(toUrlSlug(e.target.value));
              }}
              placeholder="indiranagar"
              required
            />
            <Input
              label="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Bengaluru"
            />
            <Input
              label="Phone (optional)"
              prefix="+91"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9880044556"
            />
          </div>
          <Input
            label="Street Address (optional)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="100 Feet Road, HAL 2nd Stage"
          />
          <div className="flex justify-end">
            <Button type="submit" loading={creating}>
              Save Branch
            </Button>
          </div>
        </form>
      ) : null}

      <div className="space-y-4">
        {branches.map((branch) => {
          const isEditing = editingBranchId === branch.id;
          return (
            <section
              key={branch.id}
              className="rounded-card border border-subtle bg-surface p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-muted text-ink">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-ink">{branch.name}</h2>
                    <p className="font-mono text-xs text-ink-secondary">
                      slug: {branch.slug} • stations:{" "}
                      {branch.settings?.activeStationsCount ?? 1}
                    </p>
                    {branch.city || branch.address ? (
                      <p className="mt-1 text-xs text-ink-secondary">
                        {[branch.address, branch.city].filter(Boolean).join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      branch.isActive
                        ? "rounded-full bg-status-completed-bg px-3 py-1 text-xs font-semibold text-status-completed-fg"
                        : "rounded-full bg-status-skipped-bg px-3 py-1 text-xs font-semibold text-status-skipped-fg"
                    }
                  >
                    {branch.isActive ? "Active" : "Inactive"}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      isEditing ? setEditingBranchId(null) : startEditing(branch)
                    }
                  >
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    <span>{isEditing ? "Close Editor" : "Hours & Rules"}</span>
                  </Button>
                  <Button
                    variant={branch.isActive ? "danger" : "primary"}
                    size="sm"
                    loading={savingId === branch.id}
                    onClick={() => handleToggleActive(branch)}
                  >
                    {branch.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>

              {isEditing ? (
                <div className="mt-5 space-y-4 border-t border-subtle pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Active Service Stations / Chairs"
                      type="number"
                      min={1}
                      max={50}
                      value={String(stationsDraft)}
                      onChange={(e) =>
                        setStationsDraft(Math.max(1, Number(e.target.value) || 1))
                      }
                    />
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-subtle bg-canvas px-4 py-2 text-sm font-medium text-ink">
                      <input
                        type="checkbox"
                        checked={allowCancelDraft}
                        onChange={(e) => setAllowCancelDraft(e.target.checked)}
                        className="h-4 w-4"
                      />
                      <span>Allow waiting customers to self-cancel</span>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-ink">
                      7-Day Business Hours
                    </h3>
                    <div className="space-y-2">
                      {hoursDraft.map((entry, idx) => (
                        <div
                          key={entry.dayOfWeek}
                          className="grid grid-cols-2 items-center gap-2 rounded-control border border-subtle px-3 py-2 text-sm sm:grid-cols-4"
                        >
                          <label className="flex items-center gap-2 font-medium text-ink">
                            <input
                              type="checkbox"
                              checked={entry.isOpen}
                              onChange={(e) =>
                                setHoursDraft((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? { ...row, isOpen: e.target.checked }
                                      : row,
                                  ),
                                )
                              }
                            />
                            <span>{DAY_NAMES[entry.dayOfWeek]}</span>
                          </label>
                          <input
                            type="time"
                            disabled={!entry.isOpen}
                            value={entry.openTime}
                            onChange={(e) =>
                              setHoursDraft((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, openTime: e.target.value } : row,
                                ),
                              )
                            }
                            className="rounded-control border border-subtle bg-surface px-2 py-1.5 text-base text-ink disabled:opacity-50 sm:text-sm"
                          />
                          <input
                            type="time"
                            disabled={!entry.isOpen}
                            value={entry.closeTime}
                            onChange={(e) =>
                              setHoursDraft((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, closeTime: e.target.value } : row,
                                ),
                              )
                            }
                            className="rounded-control border border-subtle bg-surface px-2 py-1.5 text-base text-ink disabled:opacity-50 sm:text-sm"
                          />
                          <span className="text-xs text-ink-secondary">
                            {entry.isOpen ? "Open" : "Closed"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      loading={savingId === branch.id}
                      onClick={() => handleSaveHoursAndSettings(branch.id)}
                    >
                      Save Hours &amp; Settings
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
