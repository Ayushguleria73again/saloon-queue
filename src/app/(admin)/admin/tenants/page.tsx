import { redirect } from "next/navigation";
import { TenantsDirectory } from "@/features/admin/components/tenants-directory";
import { adminTenantQuerySchema } from "@/features/admin/schemas";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requirePlatformAdmin } from "@/server/auth";
import { listTenants } from "@/server/services/platform-admin-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tenants Directory — SalonFlow Admin",
};

export default async function AdminTenantsPage(props: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    page?: string;
    limit?: string;
  }>;
}) {
  try {
    const adminCtx = await requirePlatformAdmin();
    const searchParams = await props.searchParams;

    const parsedQuery = adminTenantQuerySchema.safeParse({
      ...(searchParams.status ? { status: searchParams.status } : {}),
      ...(searchParams.q ? { q: searchParams.q } : {}),
      ...(searchParams.page ? { page: searchParams.page } : {}),
      ...(searchParams.limit ? { limit: searchParams.limit } : {}),
    });

    const initialData = await listTenants(
      adminCtx,
      parsedQuery.success ? parsedQuery.data : { status: "ALL", page: 1, limit: 20 },
    );

    return <TenantsDirectory initialData={initialData} />;
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

