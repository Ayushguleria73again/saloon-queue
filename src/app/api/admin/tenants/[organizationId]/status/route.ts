import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateTenantStatusSchema } from "@/features/admin/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { requirePlatformAdmin } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { updateTenantStatus } from "@/server/services/platform-admin-service";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid("Invalid organization identifier.");

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ organizationId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const adminCtx = await requirePlatformAdmin();
    const { organizationId } = await context.params;

    if (!uuidSchema.safeParse(organizationId).success) {
      throw new ValidationError("Invalid organization identifier.");
    }

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = updateTenantStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Invalid tenant status payload.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const clientIp = extractClientIp(request.headers);
    const userAgent = request.headers.get("user-agent") ?? undefined;

    const result = await updateTenantStatus(adminCtx, organizationId, parsed.data, {
      ipAddressHash: hashIpAddress(clientIp),
      userAgent,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
