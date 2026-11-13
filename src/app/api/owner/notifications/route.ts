import { NextRequest, NextResponse } from "next/server";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { listOwnerNotifications } from "@/server/services/owner-notification-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = createRequestId();

  try {
    const ctx = await authorizeTenantAction();
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const limit = Number.isFinite(rawLimit) ? rawLimit : 25;

    const notifications = await listOwnerNotifications(ctx, { limit });
    return NextResponse.json(
      { notifications },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
