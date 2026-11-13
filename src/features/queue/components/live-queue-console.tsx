"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  CheckCircle2,
  Clock,
  PauseCircle,
  Play,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  SkipForward,
  UserCheck,
  Users,
  UserX,
  X,
  XCircle,
} from "lucide-react";
import {
  BranchSwitcher,
  Button,
  ConfirmModal,
  Input,
  StatCard,
  StatusBadge,
  Textarea,
  useToast,
  type BranchOption,
} from "@/components/ui";
import type { PublicServiceOption } from "@/features/public-intake/types";
import { walkInTokenSchema } from "@/features/queue/schemas";
import type {
  BranchQueueOverviewDto,
  OwnerQueueSnapshotData,
  QueueTokenItemDto,
  StaffQueueAction,
} from "@/features/queue/types";
import { useRealtimeStream } from "@/features/queue/hooks/use-realtime-stream";
import { formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";
import { tryNormalizeIndianMobile } from "@/lib/phone";

interface LiveQueueConsoleProps {
  branches: BranchOption[];
  selectedBranchId: string;
  initialOverview: BranchQueueOverviewDto | null;
  branchServices: PublicServiceOption[];
  permissionKeys: string[];
}

function generateRequestUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

export function LiveQueueConsole({
  branches,
  selectedBranchId,
  initialOverview,
  branchServices,
  permissionKeys,
}: LiveQueueConsoleProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const perms = useMemo(() => new Set(permissionKeys), [permissionKeys]);

  const [overview, setOverview] = useState<BranchQueueOverviewDto | null>(
    initialOverview,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [callingNext, setCallingNext] = useState(false);
  const [busyTokenId, setBusyTokenId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<QueueTokenItemDto | null>(null);
  const [togglingPause, setTogglingPause] = useState(false);

  // Walk-in modal state
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [walkInMobile, setWalkInMobile] = useState("");
  const [walkInServiceIds, setWalkInServiceIds] = useState<string[]>([]);
  const [walkInNotes, setWalkInNotes] = useState("");
  const [walkInKey, setWalkInKey] = useState(() => generateRequestUuid());
  const [walkInSubmitting, setWalkInSubmitting] = useState(false);
  const [walkInErrors, setWalkInErrors] = useState<Record<string, string[] | undefined>>(
    {},
  );

  const etagRef = useRef<string | null>(null);

  useEffect(() => {
    setOverview(initialOverview);
    etagRef.current = null;
  }, [initialOverview]);

  const refreshQueue = useCallback(
    async (manual = false) => {
      if (!selectedBranchId) return;
      if (manual) setRefreshing(true);

      try {
        const headers: Record<string, string> = {};
        if (etagRef.current && !manual) {
          headers["If-None-Match"] = etagRef.current;
        }

        const res = await fetch(
          `/api/owner/branches/${encodeURIComponent(selectedBranchId)}/queue`,
          { method: "GET", headers, cache: "no-store" },
        );

        const nextEtag = res.headers.get("etag");
        if (nextEtag) {
          etagRef.current = nextEtag;
        }

        if (res.status === 304 || !res.ok) {
          return;
        }

        const data = (await res.json()) as BranchQueueOverviewDto;
        setOverview(data);
      } catch {
        // Keep existing snapshot during transient network hiccups.
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [selectedBranchId],
  );

  // Real-time SSE streaming with automatic single-pass snapshot updates & ETag fallback
  useRealtimeStream<OwnerQueueSnapshotData>({
    url: selectedBranchId
      ? `/api/owner/branches/${encodeURIComponent(selectedBranchId)}/queue/events`
      : null,
    enabled: Boolean(selectedBranchId),
    eventNames: ["queue_snapshot"],
    onMessage: (snapshot) => {
      if (snapshot?.overview) {
        setOverview(snapshot.overview);
      }
    },
    onReconnect: () => {
      void refreshQueue(false);
    },
  });

  function handleBranchSwitch(nextBranchId: string) {
    router.push(`/owner/queue?branchId=${encodeURIComponent(nextBranchId)}`);
  }

  async function handleCallNext() {
    if (!selectedBranchId) return;
    setCallingNext(true);
    try {
      const res = await fetch(
        `/api/owner/branches/${encodeURIComponent(selectedBranchId)}/queue/call-next`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        token?: QueueTokenItemDto;
        error?: { message?: string };
      };
      if (!res.ok || !json.token) {
        showToast({
          variant: "error",
          title: "Could not call next token",
          description: json.error?.message,
        });
        return;
      }

      showToast({
        variant: "success",
        title: `Called Token ${json.token.tokenNumber}`,
        description: `${json.token.customerName} notified to proceed to service area.`,
      });
      await refreshQueue(true);
    } finally {
      setCallingNext(false);
    }
  }

  async function handleTokenAction(tokenId: string, action: StaffQueueAction) {
    if (!selectedBranchId) return;
    setBusyTokenId(tokenId);
    try {
      const res = await fetch(
        `/api/owner/branches/${encodeURIComponent(selectedBranchId)}/tokens/${encodeURIComponent(tokenId)}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        token?: { tokenNumber: string; status: string };
        error?: { message?: string };
      };
      if (!res.ok || !json.token) {
        showToast({
          variant: "error",
          title: "Action failed",
          description: json.error?.message,
        });
        return;
      }

      showToast({
        variant: "success",
        title: `Token ${json.token.tokenNumber} updated`,
        description: `Moved to ${json.token.status.replace("_", " ").toLowerCase()}.`,
      });
      setCancelTarget(null);
      await refreshQueue(true);
    } finally {
      setBusyTokenId(null);
    }
  }

  async function handleRequeue(token: QueueTokenItemDto) {
    if (!selectedBranchId) return;
    setBusyTokenId(token.id);
    try {
      const res = await fetch(
        `/api/owner/branches/${encodeURIComponent(selectedBranchId)}/tokens/${encodeURIComponent(token.id)}/requeue`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        requeuedToken?: QueueTokenItemDto;
        error?: { message?: string };
      };
      if (!res.ok || !json.requeuedToken) {
        showToast({
          variant: "error",
          title: "Re-queue failed",
          description: json.error?.message,
        });
        return;
      }

      showToast({
        variant: "success",
        title: `Re-queued as ${json.requeuedToken.tokenNumber}`,
        description: `${token.tokenNumber} placed back into the FIFO queue.`,
      });
      await refreshQueue(true);
    } finally {
      setBusyTokenId(null);
    }
  }

  async function handleToggleQueuePause() {
    if (!selectedBranchId || !overview) return;
    setTogglingPause(true);
    try {
      const nextAccepting = !overview.isAcceptingTokens;
      const res = await fetch(
        `/api/owner/branches/${encodeURIComponent(selectedBranchId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settings: {
              isAcceptingTokens: nextAccepting,
              queuePausedReason: nextAccepting ? null : "Temporarily paused by desk",
            },
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        showToast({
          variant: "error",
          title: "Could not update queue state",
          description: json.error?.message,
        });
        return;
      }
      showToast({
        variant: "success",
        title: nextAccepting ? "Queue resumed" : "Queue paused",
      });
      await refreshQueue(true);
    } finally {
      setTogglingPause(false);
    }
  }

  function resetWalkInForm() {
    setWalkInName("");
    setWalkInMobile("");
    setWalkInServiceIds([]);
    setWalkInNotes("");
    setWalkInErrors({});
    setWalkInKey(generateRequestUuid());
  }

  async function handleWalkInSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranchId) return;
    setWalkInErrors({});

    const parsed = walkInTokenSchema.safeParse({
      fullName: walkInName,
      mobileNumber: walkInMobile,
      serviceIds: walkInServiceIds,
      notes: walkInNotes || undefined,
      idempotencyKey: walkInKey,
    });

    if (!parsed.success) {
      setWalkInErrors(parsed.error.flatten().fieldErrors);
      return;
    }

    setWalkInSubmitting(true);
    try {
      const res = await fetch(
        `/api/owner/branches/${encodeURIComponent(selectedBranchId)}/tokens/walk-in`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        token?: { tokenNumber: string };
        error?: {
          message?: string;
          details?: { fieldErrors?: Record<string, string[]> };
        };
      };

      if (!res.ok || !json.token) {
        if (json.error?.details?.fieldErrors) {
          setWalkInErrors(json.error.details.fieldErrors);
        }
        showToast({
          variant: "error",
          title: "Walk-in creation failed",
          description: json.error?.message,
        });
        return;
      }

      showToast({
        variant: "success",
        title: `Walk-in Token ${json.token.tokenNumber} added`,
        description: `${parsed.data.fullName} added to strict FIFO queue.`,
      });
      setWalkInOpen(false);
      resetWalkInForm();
      await refreshQueue(true);
    } finally {
      setWalkInSubmitting(false);
    }
  }

  if (branches.length === 0 || !overview) {
    return (
      <div className="rounded-card border border-subtle bg-surface p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold text-ink">No Branches Accessible</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Ask your organization owner to assign a branch to your profile.
        </p>
      </div>
    );
  }

  const canCallNext = perms.has("QUEUE_CALL_NEXT");
  const canWalkIn = perms.has("QUEUE_CREATE_WALKIN");
  const canStart = perms.has("QUEUE_START");
  const canComplete = perms.has("QUEUE_COMPLETE");
  const canSkip = perms.has("QUEUE_SKIP");
  const canCancel = perms.has("QUEUE_CANCEL");
  const canNoShow = perms.has("QUEUE_NO_SHOW");
  const canManageBranch = perms.has("BRANCH_MANAGE");

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col gap-4 rounded-card border border-subtle bg-surface p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Live FIFO Queue
            </h1>
            <span
              className={
                overview.isAcceptingTokens
                  ? "inline-flex items-center gap-1 rounded-full bg-status-completed-bg px-2.5 py-0.5 text-xs font-semibold text-status-completed-fg"
                  : "inline-flex items-center gap-1 rounded-full bg-status-skipped-bg px-2.5 py-0.5 text-xs font-semibold text-status-skipped-fg"
              }
            >
              {overview.isAcceptingTokens ? "Accepting Tokens" : "Paused"}
            </span>
          </div>
          <p className="text-xs text-ink-secondary">
            Business date <span className="font-mono">{overview.businessDate}</span> •{" "}
            {overview.activeStationsCount} active station
            {overview.activeStationsCount === 1 ? "" : "s"} • Est. new join wait{" "}
            <span className="font-mono font-semibold text-ink">
              ~{formatDurationMinutes(overview.estimatedNewJoinWaitMinutes)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {branches.length > 1 ? (
            <div className="min-w-[190px]">
              <BranchSwitcher
                branches={branches}
                selectedBranchId={selectedBranchId}
                onChange={handleBranchSwitch}
              />
            </div>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refreshQueue(true)}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>

          {canManageBranch ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={togglingPause}
              onClick={() => void handleToggleQueuePause()}
            >
              {overview.isAcceptingTokens ? (
                <>
                  <PauseCircle className="h-4 w-4" aria-hidden="true" />
                  Pause Intake
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4" aria-hidden="true" />
                  Resume Intake
                </>
              )}
            </Button>
          ) : null}

          {canWalkIn ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                resetWalkInForm();
                setWalkInOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Walk-In
            </Button>
          ) : null}

          {canCallNext ? (
            <Button
              type="button"
              variant="primary"
              loading={callingNext}
              disabled={overview.waitingTokens.length === 0}
              onClick={() => void handleCallNext()}
            >
              <BellRing className="h-4 w-4" aria-hidden="true" />
              Call Next ({overview.waitingTokens.length})
            </Button>
          ) : null}
        </div>
      </div>

      {/* 7 Operational KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatCard
          label="Waiting"
          value={overview.kpis.waitingCount}
          tone="accent"
          icon={<Users className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          label="Called"
          value={overview.kpis.calledCount}
          icon={<BellRing className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          label="In Service"
          value={overview.kpis.inServiceCount}
          icon={<Scissors className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          label="Completed"
          value={overview.kpis.completedCount}
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard label="Skipped" value={overview.kpis.skippedCount} />
        <StatCard
          label="Avg Wait"
          value={`${overview.kpis.avgWaitMinutes}m`}
          subtitle={`Svc avg ${overview.kpis.avgServiceMinutes}m`}
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          label="Revenue"
          value={formatPaiseToInr(overview.kpis.revenueInPaise)}
          subtitle={`${overview.kpis.totalTokens} total`}
        />
      </div>

      {/* Active & Called Columns */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* IN_SERVICE */}
        <section className="space-y-3 rounded-card border border-subtle bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">
              In Service ({overview.inServiceTokens.length})
            </h2>
          </div>

          {overview.inServiceTokens.length === 0 ? (
            <p className="rounded-control bg-muted px-4 py-6 text-center text-sm text-ink-secondary">
              No customers currently in a chair.
            </p>
          ) : (
            <div className="space-y-3">
              {overview.inServiceTokens.map((tok) => (
                <article
                  key={tok.id}
                  className="rounded-control border border-subtle bg-canvas p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xl font-bold tabular-nums text-ink">
                          {tok.tokenNumber}
                        </span>
                        <StatusBadge status={tok.status} />
                        {tok.source === "WALK_IN" ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                            Walk-In
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm font-medium text-ink">
                        {tok.customerName} •{" "}
                        <span className="font-mono text-ink-secondary">
                          {tok.customerMobile}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-secondary">
                        {tok.services.map((s) => s.serviceName).join(", ")} (
                        {formatDurationMinutes(tok.totalDurationMinutes)} •{" "}
                        {formatPaiseToInr(tok.totalPriceInPaise)})
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canComplete ? (
                        <Button
                          size="sm"
                          variant="primary"
                          loading={busyTokenId === tok.id}
                          onClick={() => void handleTokenAction(tok.id, "COMPLETE")}
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Complete
                        </Button>
                      ) : null}
                      {canCancel ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyTokenId === tok.id}
                          onClick={() => setCancelTarget(tok)}
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* CALLED */}
        <section className="space-y-3 rounded-card border border-subtle bg-surface p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">
            Called — Approaching Chair ({overview.calledTokens.length})
          </h2>

          {overview.calledTokens.length === 0 ? (
            <p className="rounded-control bg-muted px-4 py-6 text-center text-sm text-ink-secondary">
              Use &ldquo;Call Next&rdquo; to summon the head of the waiting line.
            </p>
          ) : (
            <div className="space-y-3">
              {overview.calledTokens.map((tok) => (
                <article
                  key={tok.id}
                  className="rounded-control border border-subtle bg-canvas p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xl font-bold tabular-nums text-ink">
                          {tok.tokenNumber}
                        </span>
                        <StatusBadge status={tok.status} />
                      </div>
                      <p className="mt-1 text-sm font-medium text-ink">
                        {tok.customerName} •{" "}
                        <span className="font-mono text-ink-secondary">
                          {tok.customerMobile}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-secondary">
                        {tok.services.map((s) => s.serviceName).join(", ")} (
                        {formatDurationMinutes(tok.totalDurationMinutes)} •{" "}
                        {formatPaiseToInr(tok.totalPriceInPaise)})
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canStart ? (
                        <Button
                          size="sm"
                          variant="primary"
                          loading={busyTokenId === tok.id}
                          onClick={() => void handleTokenAction(tok.id, "START_SERVICE")}
                        >
                          <Play className="h-4 w-4" aria-hidden="true" />
                          Start Service
                        </Button>
                      ) : null}
                      {canSkip ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyTokenId === tok.id}
                          onClick={() => void handleTokenAction(tok.id, "SKIP")}
                        >
                          <SkipForward className="h-4 w-4" aria-hidden="true" />
                          Skip
                        </Button>
                      ) : null}
                      {canNoShow ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyTokenId === tok.id}
                          onClick={() => void handleTokenAction(tok.id, "MARK_NO_SHOW")}
                        >
                          <UserX className="h-4 w-4" aria-hidden="true" />
                          No-Show
                        </Button>
                      ) : null}
                      {canCancel ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyTokenId === tok.id}
                          onClick={() => setCancelTarget(tok)}
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Strict FIFO Waiting Line */}
      <section className="space-y-3 rounded-card border border-subtle bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">
            Strict FIFO Waiting Line ({overview.waitingTokens.length})
          </h2>
          <p className="text-xs text-ink-secondary">
            Ordered strictly by sequence number (no manual reordering).
          </p>
        </div>

        {overview.waitingTokens.length === 0 ? (
          <p className="rounded-control bg-muted px-4 py-8 text-center text-sm text-ink-secondary">
            Waiting line is clear. Scan the branch QR code or click &ldquo;+ Add
            Walk-In&rdquo;.
          </p>
        ) : (
          <div className="divide-y divide-subtle">
            {overview.waitingTokens.map((tok, index) => (
              <div
                key={tok.id}
                className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-14 shrink-0 items-center justify-center rounded-control bg-muted font-mono text-base font-bold tabular-nums text-ink">
                    {tok.tokenNumber}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {tok.customerName}
                      </span>
                      <span className="font-mono text-xs text-ink-secondary">
                        {tok.customerMobile}
                      </span>
                      <span className="rounded-full bg-status-waiting-bg px-2 py-0.5 font-mono text-[11px] font-medium text-status-waiting-fg">
                        #{index + 1} • ~{formatDurationMinutes(tok.estimatedWaitMinutes)}
                      </span>
                      {tok.source === "WALK_IN" ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                          Walk-In
                        </span>
                      ) : null}
                      {tok.requeuedFromTokenId ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-brand-accent">
                          Re-queued
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-secondary">
                      {tok.services.map((s) => s.serviceName).join(", ")} •{" "}
                      {formatDurationMinutes(tok.totalDurationMinutes)} •{" "}
                      {formatPaiseToInr(tok.totalPriceInPaise)}
                    </p>
                    {tok.notes ? (
                      <p className="mt-0.5 text-xs italic text-ink-secondary">
                        &ldquo;{tok.notes}&rdquo;
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canStart ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busyTokenId === tok.id}
                      onClick={() => void handleTokenAction(tok.id, "START_SERVICE")}
                    >
                      <UserCheck className="h-4 w-4" aria-hidden="true" />
                      Seat Now
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyTokenId === tok.id}
                      onClick={() => setCancelTarget(tok)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Skipped Today */}
      {overview.skippedTokens.length > 0 ? (
        <section className="space-y-3 rounded-card border border-subtle bg-surface p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">
            Skipped Today ({overview.skippedTokens.length})
          </h2>
          <div className="divide-y divide-subtle">
            {overview.skippedTokens.map((tok) => (
              <div
                key={tok.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold text-ink">
                      {tok.tokenNumber}
                    </span>
                    <StatusBadge status={tok.status} />
                    <span className="text-sm font-medium text-ink">
                      {tok.customerName}
                    </span>
                    <span className="font-mono text-xs text-ink-secondary">
                      {tok.customerMobile}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    {tok.services.map((s) => s.serviceName).join(", ")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canCallNext ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busyTokenId === tok.id}
                      onClick={() => void handleRequeue(tok)}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Re-queue to Tail
                    </Button>
                  ) : null}
                  {canNoShow ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyTokenId === tok.id}
                      onClick={() => void handleTokenAction(tok.id, "MARK_NO_SHOW")}
                    >
                      No-Show
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyTokenId === tok.id}
                      onClick={() => setCancelTarget(tok)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Walk-In Modal */}
      {walkInOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            aria-hidden="true"
            className="fixed inset-0 bg-brand-primary/50 backdrop-blur-[1px]"
            onClick={() => {
              if (!walkInSubmitting) setWalkInOpen(false);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="walkin-modal-title"
            className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-subtle bg-surface p-6 shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-subtle pb-3">
              <h2 id="walkin-modal-title" className="text-lg font-bold text-ink">
                Add Walk-In Customer
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setWalkInOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-control text-ink-secondary hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleWalkInSubmit} className="mt-4 space-y-4">
              <Input
                label="Customer Name"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                error={walkInErrors.fullName?.[0]}
                placeholder="e.g., Arjun Mehta"
                required
              />

              <Input
                label="Mobile Number"
                prefix="+91"
                inputMode="numeric"
                value={walkInMobile}
                onChange={(e) => setWalkInMobile(e.target.value)}
                onBlur={() => {
                  const normalized = tryNormalizeIndianMobile(walkInMobile);
                  if (normalized) setWalkInMobile(normalized);
                }}
                error={walkInErrors.mobileNumber?.[0]}
                placeholder="9876543210"
                required
              />

              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">Select Services</p>
                {walkInErrors.serviceIds?.[0] ? (
                  <p className="text-xs font-medium text-status-cancelled-fg">
                    {walkInErrors.serviceIds[0]}
                  </p>
                ) : null}
                {branchServices.length === 0 ? (
                  <p className="rounded-control bg-muted p-3 text-xs text-ink-secondary">
                    No active services available at this branch yet.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {branchServices.map((svc) => {
                      const checked = walkInServiceIds.includes(svc.id);
                      return (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() =>
                            setWalkInServiceIds((prev) =>
                              prev.includes(svc.id)
                                ? prev.filter((id) => id !== svc.id)
                                : [...prev, svc.id],
                            )
                          }
                          className={`flex min-h-12 flex-col items-start justify-center rounded-control border px-3 py-2 text-left transition ${
                            checked
                              ? "border-brand-primary bg-muted font-semibold"
                              : "border-subtle bg-surface hover:bg-muted/60"
                          }`}
                        >
                          <span className="text-sm text-ink">{svc.name}</span>
                          <span className="font-mono text-xs text-ink-secondary">
                            {formatDurationMinutes(svc.durationMinutes)} •{" "}
                            {formatPaiseToInr(svc.priceInPaise)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <Textarea
                label="Staff Note (Optional)"
                value={walkInNotes}
                onChange={(e) => setWalkInNotes(e.target.value)}
                error={walkInErrors.notes?.[0]}
                placeholder="Preferred stylist or styling notes"
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={walkInSubmitting}
                  onClick={() => setWalkInOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={walkInSubmitting}>
                  Issue Walk-In Token
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(cancelTarget)}
        tone="danger"
        title={`Cancel Token ${cancelTarget?.tokenNumber ?? ""}?`}
        description="This immediately removes the customer from the active queue and records an audit entry."
        confirmLabel="Cancel Token"
        cancelLabel="Keep"
        loading={Boolean(cancelTarget && busyTokenId === cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => {
          if (cancelTarget) {
            void handleTokenAction(cancelTarget.id, "CANCEL");
          }
        }}
      />
    </div>
  );
}
