"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  MapPin,
  RefreshCw,
  Scissors,
  Users,
} from "lucide-react";
import { Button, ConfirmModal, StatusBadge } from "@/components/ui";
import { CustomerPushOptInCard } from "@/features/notifications/components/customer-push-opt-in-card";
import type {
  CustomerTokenUpdateData,
  PublicTokenTrackingDto,
} from "@/features/public-intake/types";
import { useRealtimeStream } from "@/features/queue/hooks/use-realtime-stream";
import { formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";

interface TokenTrackerViewProps {
  initialToken: PublicTokenTrackingDto;
  vapidPublicKey?: string;
}

const POLLABLE_ACTIVE_STATUSES = new Set(["WAITING", "CALLED", "IN_SERVICE"]);

export function TokenTrackerView({
  initialToken,
  vapidPublicKey = "",
}: TokenTrackerViewProps) {
  const [token, setToken] = useState<PublicTokenTrackingDto>(initialToken);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);

  const storageKey = `salonflow_active_token_${token.branch.id}`;

  useEffect(() => {
    setToken(initialToken);
  }, [initialToken]);

  // Synchronize local shortcut storage cleanly across active, closed, or re-queued states.
  useEffect(() => {
    try {
      if (POLLABLE_ACTIVE_STATUSES.has(token.status)) {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            publicId: token.publicId,
            tokenNumber: token.tokenNumber,
          }),
        );
      } else if (token.status === "SKIPPED" && token.requeuedTo) {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            publicId: token.requeuedTo.publicId,
            tokenNumber: token.requeuedTo.tokenNumber,
          }),
        );
      } else {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { publicId?: string };
          if (parsed.publicId === token.publicId) {
            window.localStorage.removeItem(storageKey);
          }
        }
      }
    } catch {
      // Ignore storage access restrictions silently.
    }
  }, [storageKey, token.publicId, token.requeuedTo, token.status, token.tokenNumber]);

  const fetchLatestToken = useCallback(
    async (manual = false) => {
      if (manual) {
        setRefreshing(true);
      }

      try {
        const headers: Record<string, string> = {};
        if (etagRef.current) {
          headers["If-None-Match"] = etagRef.current;
        }

        const response = await fetch(
          `/api/public/tokens/${encodeURIComponent(token.publicId)}`,
          {
            method: "GET",
            headers,
            cache: "no-store",
          },
        );

        const nextEtag = response.headers.get("etag");
        if (nextEtag) {
          etagRef.current = nextEtag;
        }

        if (response.status === 304) {
          return;
        }

        if (!response.ok) {
          return;
        }

        const latest = (await response.json()) as PublicTokenTrackingDto;
        setToken(latest);
        setErrorMessage(null);
      } catch {
        // Keep last good ticket snapshot when temporarily offline.
      } finally {
        if (manual) {
          setRefreshing(false);
        }
      }
    },
    [token.publicId],
  );

  // Real-time SSE streaming for customer token updates with automatic ETag polling fallback
  const isTerminal =
    token.status === "COMPLETED" ||
    token.status === "CANCELLED" ||
    token.status === "NO_SHOW";

  useRealtimeStream<CustomerTokenUpdateData>({
    url: !isTerminal
      ? `/api/public/tokens/${encodeURIComponent(token.publicId)}/events`
      : null,
    enabled: !isTerminal,
    eventNames: ["token_update"],
    onMessage: (update) => {
      if (update) {
        setToken((prev) => ({
          ...prev,
          status: update.status,
          queuePosition: update.queuePosition,
          peopleAhead: update.peopleAhead,
          estimatedWaitMinutes: update.estimatedWaitMinutes,
          totalPriceInPaise: update.totalPriceInPaise || prev.totalPriceInPaise,
          totalDurationMinutes:
            update.totalDurationMinutes || prev.totalDurationMinutes,
          requeuedTo: update.requeuedTo ?? prev.requeuedTo,
          canCustomerCancel:
            update.status === "WAITING" && prev.allowCustomerCancelSetting,
        }));
      }
    },
    onReconnect: () => {
      void fetchLatestToken(false);
    },
  });

  async function handleConfirmCancel() {
    setCancelling(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/public/tokens/${encodeURIComponent(token.publicId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      const json = (await response.json().catch(() => ({}))) as {
        token?: PublicTokenTrackingDto;
        error?: { message?: string };
      };

      if (!response.ok || !json.token) {
        setErrorMessage(json.error?.message ?? "Unable to cancel token right now.");
        setConfirmCancelOpen(false);
        void fetchLatestToken(false);
        return;
      }

      setToken(json.token);
      setConfirmCancelOpen(false);
    } catch {
      setErrorMessage("Network error while cancelling token. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  const branchIntakeHref = `/salon/${encodeURIComponent(token.organization.slug)}/${encodeURIComponent(token.branch.slug)}`;
  const isClosedState =
    token.status === "COMPLETED" ||
    token.status === "CANCELLED" ||
    token.status === "NO_SHOW";

  return (
    <main className="space-y-5 pb-12">
      {/* Salon Header */}
      <header className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-accent">
              {token.organization.name}
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-ink">
              {token.branch.name}
            </h1>
            {token.branch.address || token.branch.city ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-secondary">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {[token.branch.address, token.branch.city].filter(Boolean).join(", ")}
                </span>
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void fetchLatestToken(true)}
            disabled={refreshing}
            aria-label="Refresh ticket status"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </header>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-control bg-status-cancelled-bg px-4 py-3 text-sm font-medium text-status-cancelled-fg"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* Re-queued Banner */}
      {token.status === "SKIPPED" && token.requeuedTo ? (
        <section className="rounded-card border border-brand-accent/40 bg-status-waiting-bg p-5 shadow-sm">
          <h2 className="text-base font-semibold text-status-waiting-fg">
            You were re-queued as Token {token.requeuedTo.tokenNumber}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            This earlier token was skipped and our front desk placed you back into the
            live queue with a fresh ticket number.
          </p>
          <Link
            href={token.requeuedTo.url}
            className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-control bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-foreground hover:opacity-95"
          >
            Open Active Token ({token.requeuedTo.tokenNumber})
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      ) : null}

      {/* Hero Ticket Card */}
      <section
        aria-live="polite"
        className="rounded-card border border-subtle bg-surface p-6 text-center shadow-sm"
      >
        <div className="flex justify-center">
          <StatusBadge status={token.status} />
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Your Queue Token
        </p>
        <p className="mt-1 font-mono text-5xl font-bold tracking-tight tabular-nums text-ink sm:text-6xl">
          {token.tokenNumber}
        </p>

        {token.status === "WAITING" ? (
          <div className="mt-4 space-y-1.5 rounded-control bg-status-completed-bg/60 p-4 text-left">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-status-completed-fg">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Your token has been generated successfully!
            </p>
            <p className="text-sm text-ink-secondary">
              Please wait for your turn. We will notify you when your turn is approaching.
            </p>
          </div>
        ) : token.status === "CALLED" ? (
          <div className="mt-4 rounded-control bg-status-called-bg p-4 text-left">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-status-called-fg">
              <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
              It is your turn now! Please proceed to the service counter.
            </p>
          </div>
        ) : token.status === "IN_SERVICE" ? (
          <div className="mt-4 rounded-control bg-status-inservice-bg p-4 text-left">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-status-inservice-fg">
              <Scissors className="h-4 w-4 shrink-0" aria-hidden="true" />
              You are currently in service.
            </p>
          </div>
        ) : token.status === "COMPLETED" ? (
          <p className="mt-4 text-sm text-ink-secondary">
            Thank you for visiting {token.organization.name}! Your service is complete.
          </p>
        ) : token.status === "CANCELLED" ? (
          <p className="mt-4 text-sm text-ink-secondary">
            This token was cancelled. You can generate a fresh token anytime if needed.
          </p>
        ) : token.status === "NO_SHOW" ? (
          <p className="mt-4 text-sm text-ink-secondary">
            This token was marked as no-show. Please check with front-desk staff.
          </p>
        ) : !token.requeuedTo ? (
          <p className="mt-4 text-sm text-ink-secondary">
            Your token was skipped because you were unavailable when called. Ask our desk
            staff to re-queue you if you have arrived.
          </p>
        ) : null}

        {token.status === "WAITING" ? (
          <div className="mt-5 grid grid-cols-3 gap-2.5 border-t border-subtle pt-5 text-left">
            <div className="rounded-control bg-muted p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
                Position
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
                #{token.queuePosition}
              </p>
            </div>
            <div className="rounded-control bg-muted p-3">
              <p className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
                <Users className="h-3 w-3" aria-hidden="true" />
                Ahead
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
                {token.peopleAhead}
              </p>
            </div>
            <div className="rounded-control bg-muted p-3">
              <p className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
                <Clock className="h-3 w-3" aria-hidden="true" />
                Est. Wait
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
                ~{formatDurationMinutes(token.estimatedWaitMinutes)}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {POLLABLE_ACTIVE_STATUSES.has(token.status) ? (
        <CustomerPushOptInCard
          publicId={token.publicId}
          tokenNumber={token.tokenNumber}
          vapidPublicKey={vapidPublicKey}
          initialSubscribed={token.pushAlertsEnabled}
          onSubscribedChange={(subscribed) =>
            setToken((prev) => ({ ...prev, pushAlertsEnabled: subscribed }))
          }
        />
      ) : null}

      {/* Customer & Selected Services Card (Mobile Masked Only) */}
      <section className="space-y-4 rounded-card border border-subtle bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">{token.customerName}</h2>
            <p className="font-mono text-xs text-ink-secondary">{token.maskedMobile}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-bold tabular-nums text-ink">
              {formatPaiseToInr(token.totalPriceInPaise)}
            </p>
            <p className="font-mono text-xs text-ink-secondary">
              {formatDurationMinutes(token.totalDurationMinutes)} est.
            </p>
          </div>
        </div>

        <ul className="divide-y divide-subtle/70">
          {token.services.map((svc, idx) => (
            <li
              key={`${svc.name}-${idx}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="font-medium text-ink">{svc.name}</span>
              <span className="font-mono text-xs tabular-nums text-ink-secondary">
                {formatDurationMinutes(svc.durationMinutes)} •{" "}
                {formatPaiseToInr(svc.priceInPaise)}
              </span>
            </li>
          ))}
        </ul>

        {token.notes ? (
          <p className="rounded-control bg-muted px-3 py-2 text-xs text-ink-secondary">
            Note: {token.notes}
          </p>
        ) : null}
      </section>

      {/* Self-Cancel / Back to Branch Actions */}
      {token.canCustomerCancel ? (
        <section className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Changed your plans?</h2>
              <p className="text-xs text-ink-secondary">
                You can cancel your token online while you are still waiting.
              </p>
            </div>
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmCancelOpen(true)}
            >
              Cancel My Token
            </Button>
          </div>
        </section>
      ) : token.status === "CALLED" || token.status === "IN_SERVICE" ? (
        <p className="text-center text-xs text-ink-secondary">
          Online cancellation is unavailable once your token is called or in service.
        </p>
      ) : isClosedState ? (
        <div className="text-center">
          <Link
            href={branchIntakeHref}
            className="inline-flex min-h-12 items-center justify-center rounded-control bg-brand-primary px-5 py-3 text-sm font-semibold text-brand-foreground hover:opacity-95"
          >
            Join Queue Again
          </Link>
        </div>
      ) : null}

      <ConfirmModal
        open={confirmCancelOpen}
        tone="danger"
        title={`Cancel Token ${token.tokenNumber}?`}
        description="Your spot in the queue will be released immediately and cannot be restored."
        confirmLabel="Yes, Cancel Token"
        cancelLabel="Keep My Spot"
        loading={cancelling}
        onCancel={() => setConfirmCancelOpen(false)}
        onConfirm={() => void handleConfirmCancel()}
      />
    </main>
  );
}
