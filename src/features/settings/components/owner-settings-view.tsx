"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { BellRing, Lock, Save, Settings } from "lucide-react";
import { Button, Input, useToast } from "@/components/ui";
import { changePasswordSchema } from "@/features/auth/schemas";
import { branchSettingsUpdateSchema } from "@/features/branches/schemas";

export interface OrganizationSettingsDto {
  tokenPrefix: string;
  activeStationsCount: number;
  allowDuplicateActiveTokens: boolean;
  allowCustomerCancel: boolean;
  enforceBusinessHours: boolean;
  isAcceptingTokens: boolean;
  queuePausedReason: string | null;
  requireValidQrToken: boolean;
  estimatedBufferMinutes: number;
}

interface OwnerSettingsViewProps {
  canManageSettings: boolean;
  initialSettings: OrganizationSettingsDto;
}

export function OwnerSettingsView({
  canManageSettings,
  initialSettings,
}: OwnerSettingsViewProps) {
  const { showToast } = useToast();

  // Organization default queue settings
  const [tokenPrefix, setTokenPrefix] = useState(initialSettings.tokenPrefix);
  const [activeStationsCount, setActiveStationsCount] = useState(
    String(initialSettings.activeStationsCount),
  );
  const [estimatedBufferMinutes, setEstimatedBufferMinutes] = useState(
    String(initialSettings.estimatedBufferMinutes),
  );
  const [allowDuplicateActiveTokens, setAllowDuplicateActiveTokens] = useState(
    initialSettings.allowDuplicateActiveTokens,
  );
  const [allowCustomerCancel, setAllowCustomerCancel] = useState(
    initialSettings.allowCustomerCancel,
  );
  const [enforceBusinessHours, setEnforceBusinessHours] = useState(
    initialSettings.enforceBusinessHours,
  );
  const [requireValidQrToken, setRequireValidQrToken] = useState(
    initialSettings.requireValidQrToken,
  );
  const [isAcceptingTokens, setIsAcceptingTokens] = useState(
    initialSettings.isAcceptingTokens,
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Account password update
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  async function handleSaveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = branchSettingsUpdateSchema.safeParse({
      tokenPrefix,
      activeStationsCount: Number(activeStationsCount),
      estimatedBufferMinutes: Number(estimatedBufferMinutes),
      allowDuplicateActiveTokens,
      allowCustomerCancel,
      enforceBusinessHours,
      requireValidQrToken,
      isAcceptingTokens,
    });

    if (!parsed.success) {
      showToast({
        variant: "error",
        title: "Invalid settings",
        description: "Check prefix, station count, and buffer minutes.",
      });
      return;
    }

    setSavingSettings(true);
    try {
      const res = await fetch("/api/owner/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        showToast({
          variant: "error",
          title: "Save failed",
          description: json.error?.message,
        });
        return;
      }

      showToast({
        variant: "success",
        title: "Default organization settings saved",
        description: "Applied cleanly to all newly created branches.",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
    });
    if (!parsed.success) {
      showToast({
        variant: "error",
        title: "Invalid password input",
        description: "New password must be at least 8 characters.",
      });
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/owner/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        showToast({
          variant: "error",
          title: "Password update failed",
          description: json.error?.message,
        });
        return;
      }

      showToast({
        variant: "success",
        title: "Password updated",
        description: "Please sign back in with your new password.",
      });
      await signOut({ callbackUrl: "/login" });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
          <p className="text-sm text-ink-secondary">
            Configure default queue policies for new branches and manage account security.
          </p>
        </div>

        <Link
          href="/owner/settings/notifications"
          className="inline-flex min-h-11 items-center gap-2 rounded-control border border-subtle bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:bg-muted"
        >
          <BellRing className="h-4 w-4 text-brand-accent" aria-hidden="true" />
          <span>Device Alerts &amp; Delivery Logs</span>
        </Link>
      </div>

      {canManageSettings ? (
        <form
          onSubmit={handleSaveSettings}
          className="space-y-5 rounded-card border border-subtle bg-surface p-6 shadow-sm"
        >
          <div className="flex items-center gap-2 border-b border-subtle pb-3">
            <Settings className="h-5 w-5 text-brand-accent" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-ink">
              Organization Default Queue Rules
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Default Token Prefix"
              value={tokenPrefix}
              onChange={(e) => setTokenPrefix(e.target.value.toUpperCase())}
              maxLength={4}
              required
            />
            <Input
              label="Default Active Stations"
              type="number"
              min={1}
              max={50}
              value={activeStationsCount}
              onChange={(e) => setActiveStationsCount(e.target.value)}
              required
            />
            <Input
              label="Wait Buffer (Minutes)"
              type="number"
              min={0}
              max={180}
              value={estimatedBufferMinutes}
              onChange={(e) => setEstimatedBufferMinutes(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-h-12 items-center gap-3 rounded-control border border-subtle px-3.5 py-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={isAcceptingTokens}
                onChange={(e) => setIsAcceptingTokens(e.target.checked)}
                className="h-4 w-4 rounded border-subtle"
              />
              <span>Accept new tokens by default</span>
            </label>

            <label className="flex min-h-12 items-center gap-3 rounded-control border border-subtle px-3.5 py-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={enforceBusinessHours}
                onChange={(e) => setEnforceBusinessHours(e.target.checked)}
                className="h-4 w-4 rounded border-subtle"
              />
              <span>Enforce weekly business hours on QR intake</span>
            </label>

            <label className="flex min-h-12 items-center gap-3 rounded-control border border-subtle px-3.5 py-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={allowCustomerCancel}
                onChange={(e) => setAllowCustomerCancel(e.target.checked)}
                className="h-4 w-4 rounded border-subtle"
              />
              <span>Allow customers to self-cancel while waiting</span>
            </label>

            <label className="flex min-h-12 items-center gap-3 rounded-control border border-subtle px-3.5 py-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={allowDuplicateActiveTokens}
                onChange={(e) => setAllowDuplicateActiveTokens(e.target.checked)}
                className="h-4 w-4 rounded border-subtle"
              />
              <span>Allow duplicate active tokens per mobile number</span>
            </label>

            <label className="flex min-h-12 items-center gap-3 rounded-control border border-subtle px-3.5 py-2.5 text-sm text-ink sm:col-span-2">
              <input
                type="checkbox"
                checked={requireValidQrToken}
                onChange={(e) => setRequireValidQrToken(e.target.checked)}
                className="h-4 w-4 rounded border-subtle"
              />
              <span>Require official branch QR token (`?t=`) for check-in</span>
            </label>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={savingSettings}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save Defaults
            </Button>
          </div>
        </form>
      ) : null}

      <form
        onSubmit={handleChangePassword}
        className="space-y-4 rounded-card border border-subtle bg-surface p-6 shadow-sm"
      >
        <div className="flex items-center gap-2 border-b border-subtle pb-3">
          <Lock className="h-5 w-5 text-brand-accent" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">Change Account Password</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Current Password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            required
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="secondary" loading={savingPassword}>
            Update Password &amp; Re-Authenticate
          </Button>
        </div>
      </form>
    </div>
  );
}
