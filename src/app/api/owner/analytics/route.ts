import { NextRequest, NextResponse } from "next/server";
import { analyticsQuerySchema } from "@/features/analytics/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { getTenantAnalytics } from "@/server/services/analytics-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = createRequestId();

  try {
    const sp = request.nextUrl.searchParams;
    const rawBranchId = sp.get("branchId");

    const ctx = await authorizeTenantAction({
      requiredPermission: "ANALYTICS_VIEW",
      ...(rawBranchId && rawBranchId !== "all" ? { branchId: rawBranchId } : {}),
    });

    const rawQuery = {
      ...(sp.get("range") ? { range: sp.get("range") } : {}),
      ...(rawBranchId ? { branchId: rawBranchId } : {}),
      ...(sp.get("from") ? { from: sp.get("from") } : {}),
      ...(sp.get("to") ? { to: sp.get("to") } : {}),
      ...(sp.get("granularity") ? { granularity: sp.get("granularity") } : {}),
    };

    const parsed = analyticsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ValidationError(
        "Invalid analytics query parameters.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const report = await getTenantAnalytics(ctx, parsed.data);

    return NextResponse.json(report, {
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

