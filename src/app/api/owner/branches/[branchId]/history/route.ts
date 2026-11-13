import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { branchHistoryQuerySchema } from "@/features/queue/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { getBranchTokenHistory } from "@/server/services/queue-service";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid("Invalid branch identifier.");

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ branchId: string }> },
) {
  const requestId = createRequestId();

  try {
    const { branchId } = await context.params;
    if (!uuidSchema.safeParse(branchId).success) {
      throw new ValidationError("Invalid branch identifier.");
    }

    const ctx = await authorizeTenantAction({
      requiredPermission: "HISTORY_VIEW",
      branchId,
    });

    const sp = request.nextUrl.searchParams;
    const rawQuery = {
      ...(sp.get("dateFrom") ? { dateFrom: sp.get("dateFrom") } : {}),
      ...(sp.get("dateTo") ? { dateTo: sp.get("dateTo") } : {}),
      ...(sp.get("status") ? { status: sp.get("status") } : {}),
      ...(sp.get("search") ? { search: sp.get("search") } : {}),
      ...(sp.get("cursor") ? { cursor: sp.get("cursor") } : {}),
      ...(sp.get("limit") ? { limit: sp.get("limit") } : {}),
    };

    const parsed = branchHistoryQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ValidationError(
        "Invalid history query parameters.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const history = await getBranchTokenHistory(ctx, branchId, parsed.data);

    return NextResponse.json(history, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
