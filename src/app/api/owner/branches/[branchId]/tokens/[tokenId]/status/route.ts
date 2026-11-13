import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { transitionTokenStatusSchema } from "@/features/queue/schemas";
import type { StaffQueueAction } from "@/features/queue/types";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction, type PermissionKey } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { transitionBranchToken } from "@/server/services/queue-service";

const uuidSchema = z.string().uuid();

const ACTION_PERMISSION_MAP: Record<StaffQueueAction, PermissionKey> = {
  START_SERVICE: "QUEUE_START",
  COMPLETE: "QUEUE_COMPLETE",
  SKIP: "QUEUE_SKIP",
  CANCEL: "QUEUE_CANCEL",
  MARK_NO_SHOW: "QUEUE_NO_SHOW",
};

export async function PATCH(
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

    const body: unknown = await request.json().catch(() => null);
    const parsed = transitionTokenStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please provide a valid queue transition action.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const ctx = await authorizeTenantAction({
      requiredPermission: ACTION_PERMISSION_MAP[parsed.data.action],
      branchId,
    });

    const result = await transitionBranchToken({
      organizationId: ctx.organizationId,
      branchId,
      tokenId,
      action: parsed.data.action,
      actorType: ctx.roleSlug === "OWNER" ? "OWNER" : "STAFF",
      actorId: ctx.userId,
      reason: parsed.data.reason,
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
