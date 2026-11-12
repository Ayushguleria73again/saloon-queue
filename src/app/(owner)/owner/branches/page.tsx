import { redirect } from "next/navigation";
import { BranchesManager } from "@/features/branches/components/branches-manager";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { listAccessibleBranches } from "@/server/services/branch-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Branches — SalonFlow",
};

export default async function OwnerBranchesPage() {
  try {
    const ctx = await authorizeTenantAction({ requiredPermission: "BRANCH_MANAGE" });
    const branches = await listAccessibleBranches(ctx);

    return <BranchesManager initialBranches={branches} />;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="rounded-card border border-subtle bg-surface p-6 text-sm text-ink-secondary">
          You do not have permission to manage branches.
        </div>
      );
    }
    throw error;
  }
}
