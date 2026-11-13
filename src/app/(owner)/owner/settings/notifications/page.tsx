import { redirect } from "next/navigation";
import { OwnerNotificationsManager } from "@/features/notifications/components/owner-notifications-manager";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { listAccessibleBranches } from "@/server/services/branch-service";
import {
  listOwnerNotifications,
  listOwnerPushSubscriptions,
} from "@/server/services/owner-notification-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Notifications — SalonFlow",
};

export default async function OwnerNotificationsPage() {
  try {
    const ctx = await authorizeTenantAction();
    const [branches, subState, initialNotifications] = await Promise.all([
      listAccessibleBranches(ctx),
      listOwnerPushSubscriptions(ctx),
      listOwnerNotifications(ctx, { limit: 25 }),
    ]);

    return (
      <OwnerNotificationsManager
        vapidPublicKey={subState.vapidPublicKey}
        branches={branches.map((b) => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          city: b.city,
          isActive: b.isActive,
        }))}
        initialSubscriptions={subState.subscriptions}
        initialNotifications={initialNotifications}
      />
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="rounded-card border border-subtle bg-surface p-6 text-sm text-ink-secondary">
          Unable to load notification settings.
        </div>
      );
    }
    throw error;
  }
}
