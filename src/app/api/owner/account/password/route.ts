import { NextRequest, NextResponse } from "next/server";
import { changePasswordSchema } from "@/features/auth/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { changeUserPassword } from "@/server/services/account-service";

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction();

    const body: unknown = await request.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review your password inputs.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await changeUserPassword({
      ctx,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      {
        updated: true,
        sessionVersion: result.sessionVersion,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
