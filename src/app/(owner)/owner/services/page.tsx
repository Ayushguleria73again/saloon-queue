import { redirect } from "next/navigation";
import { ServicesManager } from "@/features/services/components/services-manager";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { listServicesWithBranchMatrix } from "@/server/services/catalog-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Services — SalonFlow",
};

export default async function OwnerServicesPage() {
  try {
    const ctx = await authorizeTenantAction({ requiredPermission: "SERVICE_MANAGE" });
    const data = await listServicesWithBranchMatrix(ctx);

    return <ServicesManager initialServices={data.services} branches={data.branches} />;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="rounded-card border border-subtle bg-surface p-6 text-sm text-ink-secondary">
          You do not have permission to manage services.
        </div>
      );
    }
    throw error;
  }
}
