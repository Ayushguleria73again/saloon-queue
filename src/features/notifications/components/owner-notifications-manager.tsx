"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  BellOff,
  BellRing,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { Button, Input, useToast, type BranchOption } from "@/components/ui";
import type {
  OwnerNotificationLogDto,
  OwnerPushSubscriptionDto,
} from "@/features/notifications/types";
import { isWebPushSupported, requestAndSubscribeWebPush } from "@/lib/web-push-client";

interface OwnerNotificationsManagerProps {
  vapidPublicKey: string;
  branches: BranchOption[];
  initialSubscriptions: OwnerPushSubscriptionDto[];
  initialNotifications: OwnerNotificationLogDto[];
}

const DELIVERY_STATUS_STYLE: Record<string, string> = {
  ACCEPTED_BY_PROVIDER: "bg-status-completed-bg text-status-completed-fg",
  ACKNOWLEDGED: "bg-status-completed-bg text-status-completed-fg",
  QUEUED: "bg-status-waiting-bg text-status-waiting-fg",
  RETRYING: "bg-status-waiting-bg text-status-waiting-fg",
  FAILED: "bg-status-cancelled-bg text-status-cancelled-fg",
  DEAD_LETTER: "bg-status-cancelled-bg text-status-cancelled-fg",
};

export function OwnerNotificationsManager({
  vapidPublicKey,
  branches,
  initialSubscriptions,
  initialNotifications,
}: OwnerNotificationsManagerProps) {
  const { showToast } = useToast();

  const [subscriptions, setSubscriptions] =
    useState<OwnerPushSubscriptionDto[]>(initialSubscriptions);
  const [notifications, setNotifications] =
    useState<OwnerNotificationLogDto[]>(initialNotifications);

  const [pushSupported, setPushSupported] = useState<boolean>(true);
  const [permissionState, setPermissionState] = useState<string>("default");
  const [branchId, setBranchId] = useState<string>("");
  const [deviceLabel, setDeviceLabel] = useState<string>("Counter Browser");
  const [newTokenPref, setNewTokenPref] = useState(true);
  const [longQueuePref, setLongQueuePref] = useState(true);

  const [enabling, setEnabling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshingLogs, setRefreshingLogs] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const supported = isWebPushSupported();
    setPushSupported(supported);
    if (supported) {
      setPermissionState(Notification.permission);
    }
  }, []);

  async function reloadState() {
    setRefreshingLogs(true);
    try {
      const [subsRes, logsRes] = await Promise.all([
        fetch("/api/owner/push-subscriptions", { cache: "no-store" }),
        fetch("/api/owner/notifications?limit=25", { cache: "no-store" }),
      ]);
      if (subsRes.ok) {
        const subsJson = (await subsRes.json()) as {
          subscriptions: OwnerPushSubscriptionDto[];
        };
        setSubscriptions(subsJson.subscriptions);
      }
      if (logsRes.ok) {
        const logsJson = (await logsRes.json()) as {
          notifications: OwnerNotificationLogDto[];
        };
        setNotifications(logsJson.notifications);
      }
    } finally {
      setRefreshingLogs(false);
    }
  }

  async function handleEnableDevicePush() {
    if (!pushSupported) {
      showToast({
        variant: "error",
        title: "Web Push unavailable",
        description: "This browser environment does not support Push API.",
      });
      return;
    }

    if (!vapidPublicKey) {
      showToast({
        variant: "error",
        title: "VAPID key missing",
        description: "Configure NEXT_PUBLIC_VAPID_PUBLIC_KEY before subscribing.",
      });
      return;
    }

    setEnabling(true);
    try {
      const subOutcome = await requestAndSubscribeWebPush(vapidPublicKey);
      if (subOutcome.status === "denied") {
        setPermissionState(subOutcome.permission);
        showToast({
          variant: "error",
          title: "Notification permission blocked",
          description: "Allow notifications in browser site settings to receive alerts.",
        });
        return;
      }
      if (subOutcome.status === "unsupported" || subOutcome.status === "error") {
        showToast({
          variant: "error",
          title:
            subOutcome.status === "error" ? subOutcome.message : "Web Push unavailable",
        });
        return;
      }

      setPermissionState("granted");

      const saveRes = await fetch("/api/owner/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subOutcome.endpoint,
          keys: { p256dh: subOutcome.p256dh, auth: subOutcome.auth },
          branchId: branchId || null,
          deviceLabel: deviceLabel.trim() || undefined,
          preferences: {
            newToken: newTokenPref,
            longQueue: longQueuePref,
            testAlerts: true,
          },
        }),
      });

      const saveJson = (await saveRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!saveRes.ok) {
        showToast({
          variant: "error",
          title: "Failed to save device subscription",
          description: saveJson.error?.message,
        });
        return;
      }

      showToast({
        variant: "success",
        title: "Device alerts enabled",
        description: "Send a test push below to confirm browser delivery.",
      });
      await reloadState();
    } finally {
      setEnabling(false);
    }
  }

  async function handleRemoveSubscription(id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/owner/push-subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        showToast({ variant: "error", title: "Could not remove subscription" });
        return;
      }
      showToast({ variant: "success", title: "Device notifications disabled" });
      await reloadState();
    } finally {
      setBusyId(null);
    }
  }

  async function handleSendTestPush() {
    setTesting(true);
    try {
      const res = await fetch("/api/owner/push-subscriptions/test", {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        summary?: { deliveriesSucceeded: number; retrying: number; deadLettered: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        showToast({
          variant: "error",
          title: "Test push failed",
          description: json.error?.message,
        });
        return;
      }

      showToast({
        variant: "success",
        title: "Test notification dispatched",
        description: `Provider accepted: ${json.summary?.deliveriesSucceeded ?? 0}, Retrying: ${json.summary?.retrying ?? 0}`,
      });
      await reloadState();
    } finally {
      setTesting(false);
    }
  }

  async function handleRetryNotification(notificationId: string) {
    setBusyId(notificationId);
    try {
      const res = await fetch(
        `/api/owner/notifications/${encodeURIComponent(notificationId)}/retry`,
        { method: "POST" },
      );
      if (!res.ok) {
        showToast({ variant: "error", title: "Retry failed" });
        return;
      }
      showToast({ variant: "success", title: "Notification re-dispatched" });
      await reloadState();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/owner/settings"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Settings
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">
            Device Alerts &amp; Delivery Logs
          </h1>
          <p className="text-sm text-ink-secondary">
            Receive real-time Web Push alerts when walk-in or QR customers join your
            queue.
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void reloadState()}
          disabled={refreshingLogs}
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshingLogs ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh Logs
        </Button>
      </div>

      {/* Onboarding / Subscription Setup */}
      <section className="space-y-4 rounded-card border border-subtle bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-3">
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-brand-accent" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-ink">
              Register This Browser Device
            </h2>
          </div>

          <span className="rounded-full bg-muted px-3 py-1 font-mono text-xs text-ink-secondary">
            Permission: {pushSupported ? permissionState : "unsupported"}
          </span>
        </div>

        {!pushSupported ? (
          <div className="flex items-center gap-2.5 rounded-control bg-muted p-4 text-sm text-ink-secondary">
            <BellOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Browser Web Push is unsupported in this context. On iOS Safari, add
              SalonFlow to your Home Screen first.
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Device Label"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                placeholder="e.g., Front Desk iPad Chrome"
              />

              <div className="space-y-1.5">
                <label
                  htmlFor="push-branch-filter"
                  className="block text-sm font-medium text-ink"
                >
                  Branch Scope
                </label>
                <select
                  id="push-branch-filter"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="min-h-12 w-full rounded-control border border-subtle bg-surface px-3 text-base text-ink focus:border-brand-primary focus:outline-none sm:text-sm"
                >
                  <option value="">All Accessible Branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={newTokenPref}
                  onChange={(e) => setNewTokenPref(e.target.checked)}
                />
                <span>Alert on new customer token</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={longQueuePref}
                  onChange={(e) => setLongQueuePref(e.target.checked)}
                />
                <span>Alert on long queue threshold</span>
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="primary"
                loading={enabling}
                onClick={() => void handleEnableDevicePush()}
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                Enable Push Notifications on This Device
              </Button>

              <Button
                type="button"
                variant="secondary"
                loading={testing}
                disabled={subscriptions.length === 0}
                onClick={() => void handleSendTestPush()}
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send Test Push
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Active Subscriptions */}
      <section className="space-y-3 rounded-card border border-subtle bg-surface p-6 shadow-sm">
        <h2 className="text-base font-semibold text-ink">
          Registered Devices ({subscriptions.length})
        </h2>

        {subscriptions.length === 0 ? (
          <p className="rounded-control bg-muted px-4 py-6 text-center text-sm text-ink-secondary">
            No active push subscriptions registered for your user yet.
          </p>
        ) : (
          <div className="divide-y divide-subtle">
            {subscriptions.map((sub) => (
              <div
                key={sub.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {sub.deviceLabel ?? "Browser Device"}{" "}
                    <span className="font-normal text-ink-secondary">
                      ({sub.branchName ?? "All Accessible Branches"})
                    </span>
                  </p>
                  <p className="font-mono text-xs text-ink-secondary">
                    Provider: {sub.endpointHost}
                  </p>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  loading={busyId === sub.id}
                  onClick={() => void handleRemoveSubscription(sub.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Unsubscribe
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Delivery Logs */}
      <section className="overflow-hidden rounded-card border border-subtle bg-surface shadow-sm">
        <div className="border-b border-subtle px-6 py-4">
          <h2 className="text-base font-semibold text-ink">
            Recent Notification Deliveries
          </h2>
          <p className="text-xs text-ink-secondary">
            Shows honest Web Push provider acceptance, retries, and dead-letter errors.
          </p>
        </div>

        {notifications.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-secondary">
            No notification deliveries recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-subtle bg-muted/70 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Notification</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Attempts</th>
                  <th className="px-4 py-3">Provider Detail</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {notifications.map((notif) => (
                  <tr key={notif.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{notif.title}</p>
                      <p className="text-xs text-ink-secondary">{notif.body}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          DELIVERY_STATUS_STYLE[notif.status] ??
                          "bg-muted text-ink-secondary"
                        }`}
                      >
                        {notif.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-secondary">
                      {notif.attemptCount}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-secondary">
                      {notif.latestDelivery?.httpStatusCode
                        ? `HTTP ${notif.latestDelivery.httpStatusCode}`
                        : "Pending"}
                      {notif.latestDelivery?.errorMessage
                        ? ` — ${notif.latestDelivery.errorMessage}`
                        : ""}
                    </td>
                    <td className="px-4 py-3">
                      {notif.status === "FAILED" ||
                      notif.status === "DEAD_LETTER" ||
                      notif.status === "RETRYING" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          loading={busyId === notif.id}
                          onClick={() => void handleRetryNotification(notif.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Retry
                        </Button>
                      ) : (
                        <span className="text-xs text-ink-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
