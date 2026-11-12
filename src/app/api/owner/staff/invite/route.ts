import { NextRequest, NextResponse } from "next/server";
import { inviteStaffSchema } from "@/features/staff/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { createStaffInvite } from "@/server/services/staff-service";

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction({ requiredPermission: "STAFF_MANAGE" });

    const body: unknown = await request.json().catch(() => null);
    const parsed = inviteStaffSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review staff invitation fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const invite = await createStaffInvite(ctx, parsed.data, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      { invite },
      {
        status: 201,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
