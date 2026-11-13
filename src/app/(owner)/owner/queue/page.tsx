import { redirect } from "next/navigation";
import { LiveQueueConsole } from "@/features/queue/components/live-queue-console";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { getCachedAvailableBranchServices } from "@/server/services/catalog-service";
import { listAccessibleBranches } from "@/server/services/branch-service";
import { getBranchQueueOverview } from "@/server/services/queue-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live Queue — SalonFlow",
};

export default async function OwnerQueuePage(props: {
  searchParams: Promise<{ branchId?: string }>;
}) {
  try {
    const { branchId: requestedBranchId } = await props.searchParams;
    const ctx = await authorizeTenantAction({ requiredPermission: "QUEUE_VIEW" });
    const branches = await listAccessibleBranches(ctx);

    const selectedBranch =
      branches.find((b) => b.id === requestedBranchId) ?? branches[0] ?? null;

    if (!selectedBranch) {
      return (
        <LiveQueueConsole
          branches={[]}
          selectedBranchId=""
          initialOverview={null}
          branchServices={[]}
          permissionKeys={[...ctx.permissions]}
        />
      );
    }

    const branchCtx = await authorizeTenantAction({
      requiredPermission: "QUEUE_VIEW",
      branchId: selectedBranch.id,
    });

    const [initialOverview, branchServices] = await Promise.all([
      getBranchQueueOverview(branchCtx, selectedBranch.id),
      getCachedAvailableBranchServices(ctx.organizationId, selectedBranch.id),
    ]);

    return (
      <LiveQueueConsole
        branches={branches.map((b) => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          city: b.city,
          isActive: b.isActive,
        }))}
        selectedBranchId={selectedBranch.id}
        initialOverview={initialOverview}
        branchServices={branchServices.map((svc) => ({
          id: svc.serviceId,
          name: svc.name,
          description: svc.description,
          priceInPaise: svc.priceInPaise,
          durationMinutes: svc.durationMinutes,
        }))}
        permissionKeys={[...ctx.permissions]}
      />
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="rounded-card border border-subtle bg-surface p-6 text-sm text-ink-secondary">
          You do not have permission to view or operate this branch queue.
        </div>
      );
    }
    throw error;
  }
}
