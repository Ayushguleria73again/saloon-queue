import { redirect } from "next/navigation";
import { AdminOverview } from "@/features/admin/components/admin-overview";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requirePlatformAdmin } from "@/server/auth";
import {
  getPlatformHealthDetails,
  getPlatformOverview,
} from "@/server/services/platform-admin-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Platform Overview — SalonFlow Admin",
};

export default async function AdminOverviewPage() {
  try {
    const adminCtx = await requirePlatformAdmin();
    const [overview, health] = await Promise.all([
      getPlatformOverview(adminCtx),
      getPlatformHealthDetails(adminCtx),
    ]);

    return <AdminOverview initialOverview={overview} initialHealth={health} />;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login?reauth=1");
    }
    if (error instanceof ForbiddenError) {
      redirect("/owner/dashboard?denied=1");
    }
    throw error;
  }
}

