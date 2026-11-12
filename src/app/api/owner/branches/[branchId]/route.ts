import { NextRequest, NextResponse } from "next/server";
import { updateBranchSchema } from "@/features/branches/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { updateBranch } from "@/server/services/branch-service";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ branchId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const { branchId } = await context.params;
    const ctx = await authorizeTenantAction({
      requiredPermission: "BRANCH_MANAGE",
      branchId,
    });

    const body: unknown = await request.json().catch(() => null);
    const parsed = updateBranchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review your branch updates.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const branch = await updateBranch(ctx, branchId, parsed.data, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      { branch },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
