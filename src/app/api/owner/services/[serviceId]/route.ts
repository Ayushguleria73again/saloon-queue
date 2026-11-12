import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateServiceSchema } from "@/features/services/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { updateOrganizationService } from "@/server/services/catalog-service";

const uuidSchema = z.string().uuid();

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ serviceId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction({ requiredPermission: "SERVICE_MANAGE" });
    const { serviceId } = await context.params;

    if (!uuidSchema.safeParse(serviceId).success) {
      throw new ValidationError("Invalid service identifier.");
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = updateServiceSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review service update fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const service = await updateOrganizationService(ctx, serviceId, parsed.data, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      { service },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
