import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateStaffMemberSchema } from "@/features/staff/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { revokeStaffMember, updateStaffMember } from "@/server/services/staff-service";

const uuidSchema = z.string().uuid();

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction({ requiredPermission: "STAFF_MANAGE" });
    const { memberId } = await context.params;
    if (!uuidSchema.safeParse(memberId).success) {
      throw new ValidationError("Invalid member identifier.");
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = updateStaffMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review staff update fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await updateStaffMember(ctx, memberId, parsed.data, {
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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction({ requiredPermission: "STAFF_MANAGE" });
    const { memberId } = await context.params;
    if (!uuidSchema.safeParse(memberId).success) {
      throw new ValidationError("Invalid member identifier.");
    }

    const result = await revokeStaffMember(ctx, memberId, {
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
