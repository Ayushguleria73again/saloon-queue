import { redirect } from "next/navigation";
import { BranchHistoryView } from "@/features/queue/components/branch-history-view";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { listAccessibleBranches } from "@/server/services/branch-service";
import { getBranchTokenHistory } from "@/server/services/queue-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Token History — SalonFlow",
};

export default async function OwnerHistoryPage(props: {
  searchParams: Promise<{ branchId?: string }>;
}) {
  try {
    const { branchId: requestedBranchId } = await props.searchParams;
    const ctx = await authorizeTenantAction({ requiredPermission: "HISTORY_VIEW" });
    const branches = await listAccessibleBranches(ctx);

    const selectedBranch =
      branches.find((b) => b.id === requestedBranchId) ?? branches[0] ?? null;

    if (!selectedBranch) {
      return (
        <BranchHistoryView
          branches={[]}
          selectedBranchId=""
          initialPage={{ items: [], nextCursor: null, hasMore: false }}
        />
      );
    }

    const branchCtx = await authorizeTenantAction({
      requiredPermission: "HISTORY_VIEW",
      branchId: selectedBranch.id,
    });
    const initialPage = await getBranchTokenHistory(branchCtx, selectedBranch.id, {
      status: "ALL",
      limit: 25,
    });

    return (
      <BranchHistoryView
        branches={branches.map((b) => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          city: b.city,
          isActive: b.isActive,
        }))}
        selectedBranchId={selectedBranch.id}
        initialPage={initialPage}
      />
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="rounded-card border border-subtle bg-surface p-6 text-sm text-ink-secondary">
          You do not have permission to view branch history.
        </div>
      );
    }
    throw error;
  }
}
