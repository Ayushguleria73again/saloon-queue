import { redirect } from "next/navigation";
import { StaffManager } from "@/features/staff/components/staff-manager";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { listStaffAndRoles } from "@/server/services/staff-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Staff & Roles — SalonFlow",
};

export default async function OwnerStaffPage() {
  try {
    const ctx = await authorizeTenantAction({ requiredPermission: "STAFF_MANAGE" });
    const data = await listStaffAndRoles(ctx);

    return (
      <StaffManager
        currentUserId={ctx.userId}
        initialMembers={data.members}
        roles={data.roles}
        branches={data.branches}
      />
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="rounded-card border border-subtle bg-surface p-6 text-sm text-ink-secondary">
          You do not have permission to manage staff and roles.
        </div>
      );
    }
    throw error;
  }
}
