import { NextResponse } from "next/server";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { requirePlatformAdmin } from "@/server/auth";
import { getPlatformOverview } from "@/server/services/platform-admin-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = createRequestId();

  try {
    const adminCtx = await requirePlatformAdmin();
    const overview = await getPlatformOverview(adminCtx);

    return NextResponse.json(overview, {
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

