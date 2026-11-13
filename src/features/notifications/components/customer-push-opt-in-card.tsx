"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Smartphone } from "lucide-react";
import { Button } from "@/components/ui";
import {
  getActiveBrowserPushEndpoint,
  isIosNonStandaloneBrowser,
  isWebPushSupported,
  requestAndSubscribeWebPush,
} from "@/lib/web-push-client";

interface CustomerPushOptInCardProps {
  publicId: string;
  tokenNumber: string;
  vapidPublicKey?: string;
  initialSubscribed: boolean;
  onSubscribedChange?: (subscribed: boolean) => void;
}

export function CustomerPushOptInCard({
  publicId,
  tokenNumber,
  vapidPublicKey = "",
  initialSubscribed,
  onSubscribedChange,
}: CustomerPushOptInCardProps) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [supported, setSupported] = useState<boolean>(true);
  const [iosNeedsHomeScreen, setIosNeedsHomeScreen] = useState(false);
  const [permissionState, setPermissionState] = useState<string>("default");
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    setSubscribed(initialSubscribed);
  }, [initialSubscribed]);

  useEffect(() => {
    const iosNonPwa = isIosNonStandaloneBrowser();
    const pushOk = isWebPushSupported();
    setIosNeedsHomeScreen(iosNonPwa);
    setSupported(pushOk);
    if (pushOk) {
      setPermissionState(Notification.permission);
    }
  }, []);

  async function handleEnableAlerts() {
    if (!vapidPublicKey) {
      setFeedbackError(
        "Push alerts are temporarily unavailable. Live screen updates below remain active.",
      );
      return;
    }

    setBusy(true);
    setFeedbackError(null);
    try {
      const outcome = await requestAndSubscribeWebPush(vapidPublicKey);

      if (outcome.status === "denied") {
        setPermissionState(outcome.permission);
        return;
      }

      if (outcome.status === "unsupported") {
        setSupported(false);
        return;
      }

      if (outcome.status === "error") {
        setFeedbackError(outcome.message);
        return;
      }

      setPermissionState("granted");

      const response = await fetch(
        `/api/public/tokens/${encodeURIComponent(publicId)}/push-subscription`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: outcome.endpoint,
            keys: { p256dh: outcome.p256dh, auth: outcome.auth },
          }),
        },
      );

      if (!response.ok) {
        const errPayload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setFeedbackError(
          errPayload?.error?.message ?? "Could not save alert subscription.",
        );
        return;
      }

      setSubscribed(true);
      onSubscribedChange?.(true);
    } catch {
      setFeedbackError(
        "Unable to register browser alerts right now. Live updates below continue working.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setBusy(true);
    setFeedbackError(null);
    try {
      const activeEndpoint = await getActiveBrowserPushEndpoint();
      const response = await fetch(
        `/api/public/tokens/${encodeURIComponent(publicId)}/push-subscription`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(activeEndpoint ? { endpoint: activeEndpoint } : {}),
        },
      );

      if (!response.ok) {
        setFeedbackError("Failed to turn off alerts. Please try again.");
        return;
      }

      setSubscribed(false);
      onSubscribedChange?.(false);
    } catch {
      setFeedbackError("Failed to turn off alerts cleanly.");
    } finally {
      setBusy(false);
    }
  }

  if (subscribed) {
    return (
      <section className="rounded-card border border-subtle bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-status-completed-bg text-status-completed-fg">
              <BellRing className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Turn alerts active for {tokenNumber}
              </h2>
              <p className="text-xs text-ink-secondary">
                We will alert this browser as your queue turn gets closer and when you are
                called.
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void handleUnsubscribe()}
          >
            Unsubscribe Alerts
          </Button>
        </div>

        {feedbackError ? (
          <p className="mt-2 text-xs text-status-cancelled-fg">{feedbackError}</p>
        ) : null}
      </section>
    );
  }

  if (iosNeedsHomeScreen) {
    return (
      <section className="rounded-card border border-subtle bg-surface p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-muted text-ink-secondary">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">iPhone & iPad Push Tip</h2>
            <p className="text-xs text-ink-secondary">
              Safari requires adding this page via Share &rarr; Add to Home Screen for
              background push alerts. Keep this tab open and your queue status below will
              update automatically.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!supported) {
    return (
      <section className="rounded-card border border-subtle bg-surface p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-muted text-ink-secondary">
            <BellOff className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Live Page Tracking Active</h2>
            <p className="text-xs text-ink-secondary">
              Background browser notifications are not supported here. Keep this page open
              to follow live queue updates automatically.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (permissionState === "denied") {
    return (
      <section className="rounded-card border border-subtle bg-surface p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-muted text-ink-secondary">
            <BellOff className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Browser Notifications Blocked
            </h2>
            <p className="text-xs text-ink-secondary">
              Notifications are blocked in your browser site settings. Live status updates
              below still refresh automatically while this page is open.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (dismissed) {
    return null;
  }

  return (
    <section className="rounded-card border border-subtle bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-status-called-bg text-status-called-fg">
            <Bell className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Want live turn alerts even if you close this tab?
            </h2>
            <p className="text-xs text-ink-secondary">
              Enable browser notifications for Token {tokenNumber}. We never prompt before
              you ask.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setDismissed(true)}
          >
            Not Now
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() => void handleEnableAlerts()}
          >
            Enable Notifications
          </Button>
        </div>
      </div>

      {feedbackError ? (
        <p className="mt-2 text-xs text-status-cancelled-fg">{feedbackError}</p>
      ) : null}
    </section>
  );
}
