import { NextResponse } from "next/server";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { requirePlatformAdmin } from "@/server/auth";
import { getPlatformHealthDetails } from "@/server/services/platform-admin-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = createRequestId();

  try {
    const adminCtx = await requirePlatformAdmin();
    const details = await getPlatformHealthDetails(adminCtx);

    return NextResponse.json(details, {
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

