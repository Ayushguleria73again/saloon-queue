import { redirect } from "next/navigation";
import { BackgroundJobsView } from "@/features/admin/components/background-jobs-view";
import { adminJobQuerySchema } from "@/features/admin/schemas";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requirePlatformAdmin } from "@/server/auth";
import { listPlatformJobs } from "@/server/services/platform-admin-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Background Jobs — SalonFlow Admin",
};

export default async function AdminJobsPage(props: {
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

    const parsedQuery = adminJobQuerySchema.safeParse({
      ...(searchParams.status ? { status: searchParams.status } : {}),
      ...(searchParams.q ? { q: searchParams.q } : {}),
      ...(searchParams.page ? { page: searchParams.page } : {}),
      ...(searchParams.limit ? { limit: searchParams.limit } : {}),
    });

    const initialData = await listPlatformJobs(
      adminCtx,
      parsedQuery.success ? parsedQuery.data : { status: "ALL", page: 1, limit: 20 },
    );

    return <BackgroundJobsView initialData={initialData} />;
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

