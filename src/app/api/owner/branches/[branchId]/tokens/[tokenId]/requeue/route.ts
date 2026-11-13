import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { requeueSkippedToken } from "@/server/services/queue-service";

const uuidSchema = z.string().uuid();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ branchId: string; tokenId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const { branchId, tokenId } = await context.params;
    if (
      !uuidSchema.safeParse(branchId).success ||
      !uuidSchema.safeParse(tokenId).success
    ) {
      throw new ValidationError("Invalid branch or token identifier.");
    }

    const ctx = await authorizeTenantAction({
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId,
    });

    const result = await requeueSkippedToken(ctx, branchId, tokenId, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
