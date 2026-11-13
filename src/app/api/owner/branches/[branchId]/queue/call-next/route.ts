import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { callNextToken } from "@/server/services/queue-service";

const uuidSchema = z.string().uuid("Invalid branch identifier.");

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ branchId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const { branchId } = await context.params;
    if (!uuidSchema.safeParse(branchId).success) {
      throw new ValidationError("Invalid branch identifier.");
    }

    const ctx = await authorizeTenantAction({
      requiredPermission: "QUEUE_CALL_NEXT",
      branchId,
    });

    const result = await callNextToken(ctx, branchId, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
