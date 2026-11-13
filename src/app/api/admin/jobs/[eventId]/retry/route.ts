import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { requirePlatformAdmin } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { retryPlatformJob } from "@/server/services/platform-admin-service";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid("Invalid notification event identifier.");

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const adminCtx = await requirePlatformAdmin();
    const { eventId } = await context.params;

    if (!uuidSchema.safeParse(eventId).success) {
      throw new ValidationError("Invalid notification event identifier.");
    }

    const clientIp = extractClientIp(request.headers);
    const userAgent = request.headers.get("user-agent") ?? undefined;

    const result = await retryPlatformJob(adminCtx, eventId, {
      ipAddressHash: hashIpAddress(clientIp),
      userAgent,
    });

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
