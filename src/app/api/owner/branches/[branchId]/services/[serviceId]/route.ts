import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { upsertBranchServiceSchema } from "@/features/services/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { upsertBranchServiceOverride } from "@/server/services/catalog-service";

const uuidSchema = z.string().uuid();

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ branchId: string; serviceId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const { branchId, serviceId } = await context.params;
    if (!uuidSchema.safeParse(serviceId).success) {
      throw new ValidationError("Invalid service identifier.");
    }

    const ctx = await authorizeTenantAction({
      requiredPermission: "SERVICE_MANAGE",
      branchId,
    });

    const body: unknown = await request.json().catch(() => null);
    const parsed = upsertBranchServiceSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review branch service override fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const branchService = await upsertBranchServiceOverride(
      ctx,
      branchId,
      serviceId,
      parsed.data,
      {
        ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    );

    return NextResponse.json(
      { branchService },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
