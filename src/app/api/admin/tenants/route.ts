import { NextRequest, NextResponse } from "next/server";
import { adminTenantQuerySchema } from "@/features/admin/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { requirePlatformAdmin } from "@/server/auth";
import { listTenants } from "@/server/services/platform-admin-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = createRequestId();

  try {
    const adminCtx = await requirePlatformAdmin();

    const sp = request.nextUrl.searchParams;
    const rawQuery = {
      ...(sp.get("status") ? { status: sp.get("status") } : {}),
      ...(sp.get("q") ? { q: sp.get("q") } : {}),
      ...(sp.get("page") ? { page: sp.get("page") } : {}),
      ...(sp.get("limit") ? { limit: sp.get("limit") } : {}),
    };

    const parsed = adminTenantQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ValidationError(
        "Invalid tenant query parameters.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await listTenants(adminCtx, parsed.data);

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

