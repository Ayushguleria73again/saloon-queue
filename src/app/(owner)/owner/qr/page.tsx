import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { QrStudio } from "@/features/qr/components/qr-studio";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { authorizeTenantAction } from "@/server/auth";
import { listAccessibleBranches } from "@/server/services/branch-service";
import { getBranchQrPayload } from "@/server/services/qr-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "QR Studio — SalonFlow",
};

export default async function OwnerQrPage(props: {
  searchParams: Promise<{ branchId?: string }>;
}) {
  try {
    const { branchId: requestedBranchId } = await props.searchParams;
    const ctx = await authorizeTenantAction({ requiredPermission: "QR_MANAGE" });
    const branches = await listAccessibleBranches(ctx);

    const selectedBranch =
      branches.find((b) => b.id === requestedBranchId) ?? branches[0] ?? null;

    if (!selectedBranch) {
      return <QrStudio branches={[]} selectedBranchId="" initialQr={null} />;
    }

    const reqHeaders = await headers();
    const host = reqHeaders.get("x-forwarded-host") ?? reqHeaders.get("host");
    const proto = reqHeaders.get("x-forwarded-proto") ?? "http";
    const appOrigin = host ? `${proto}://${host}` : undefined;

    const branchCtx = await authorizeTenantAction({
      requiredPermission: "QR_MANAGE",
      branchId: selectedBranch.id,
    });
    const qrPayload = await getBranchQrPayload(branchCtx, selectedBranch.id, {
      appOrigin,
    });

    return (
      <QrStudio
        branches={branches.map((b) => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          city: b.city,
          isActive: b.isActive,
        }))}
        selectedBranchId={selectedBranch.id}
        initialQr={{
          branchId: qrPayload.branchId,
          branchName: qrPayload.branchName,
          branchSlug: qrPayload.branchSlug,
          branchCity: qrPayload.branchCity,
          salonName: qrPayload.salonName,
          salonSlug: qrPayload.salonSlug,
          requireValidQrToken: qrPayload.requireValidQrToken,
          publicPath: qrPayload.publicPath,
          scanUrl: qrPayload.scanUrl,
          dataUrl: qrPayload.dataUrl,
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
          You do not have permission to access QR Studio.
        </div>
      );
    }
    throw error;
  }
}
