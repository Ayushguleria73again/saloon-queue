import { redirect } from "next/navigation";
import { OwnerSettingsView } from "@/features/settings/components/owner-settings-view";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { getOrganizationSettings } from "@/server/services/settings-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings — SalonFlow",
};

export default async function OwnerSettingsPage() {
  try {
    const ctx = await authorizeTenantAction();
    const canManageSettings = ctx.permissions.has("SETTINGS_MANAGE");

    const settings = canManageSettings ? await getOrganizationSettings(ctx) : null;

    return (
      <OwnerSettingsView
        canManageSettings={canManageSettings}
        initialSettings={{
          tokenPrefix: settings?.tokenPrefix ?? "A",
          activeStationsCount: settings?.activeStationsCount ?? 1,
          allowDuplicateActiveTokens: settings?.allowDuplicateActiveTokens ?? false,
          allowCustomerCancel: settings?.allowCustomerCancel ?? true,
          enforceBusinessHours: settings?.enforceBusinessHours ?? true,
          isAcceptingTokens: settings?.isAcceptingTokens ?? true,
          queuePausedReason: settings?.queuePausedReason ?? null,
          requireValidQrToken: settings?.requireValidQrToken ?? false,
          estimatedBufferMinutes: settings?.estimatedBufferMinutes ?? 0,
        }}
      />
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="rounded-card border border-subtle bg-surface p-6 text-sm text-ink-secondary">
          Unable to open settings for your account.
        </div>
      );
    }
    throw error;
  }
}
