import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { walkInTokenSchema } from "@/features/queue/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { createWalkInToken } from "@/server/services/queue-service";

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
      requiredPermission: "QUEUE_CREATE_WALKIN",
      branchId,
    });

    const body: unknown = await request.json().catch(() => null);
    const parsed = walkInTokenSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please check customer details and selected services.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await createWalkInToken(ctx, branchId, parsed.data, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      {
        token: result.token,
        redirectUrl: result.redirectUrl,
      },
      {
        status: result.isIdempotentReplay ? 200 : 201,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
