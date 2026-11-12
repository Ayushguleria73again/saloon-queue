import { NextRequest, NextResponse } from "next/server";
import { branchSettingsUpdateSchema } from "@/features/branches/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from "@/server/services/settings-service";

export async function GET() {
  const requestId = createRequestId();

  try {
    const ctx = await authorizeTenantAction({ requiredPermission: "SETTINGS_MANAGE" });
    const settings = await getOrganizationSettings(ctx);

    return NextResponse.json(
      { settings },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction({ requiredPermission: "SETTINGS_MANAGE" });

    const body: unknown = await request.json().catch(() => null);
    const parsed = branchSettingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review your organization settings.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const settings = await updateOrganizationSettings(ctx, parsed.data, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      { settings },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
