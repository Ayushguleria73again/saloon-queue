import { NextRequest, NextResponse } from "next/server";
import { createBranchSchema } from "@/features/branches/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { createBranch, listAccessibleBranches } from "@/server/services/branch-service";

export async function GET() {
  const requestId = createRequestId();

  try {
    const ctx = await authorizeTenantAction();
    const branches = await listAccessibleBranches(ctx);

    return NextResponse.json(
      { branches },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction({ requiredPermission: "BRANCH_MANAGE" });

    const body: unknown = await request.json().catch(() => null);
    const parsed = createBranchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review the branch details.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const branch = await createBranch(ctx, parsed.data, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      { branch },
      {
        status: 201,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
