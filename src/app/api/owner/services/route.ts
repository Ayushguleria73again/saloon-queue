import { NextRequest, NextResponse } from "next/server";
import { createServiceSchema } from "@/features/services/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  createOrganizationService,
  listServicesWithBranchMatrix,
} from "@/server/services/catalog-service";

export async function GET() {
  const requestId = createRequestId();

  try {
    const ctx = await authorizeTenantAction({ requiredPermission: "SERVICE_MANAGE" });
    const data = await listServicesWithBranchMatrix(ctx);

    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction({ requiredPermission: "SERVICE_MANAGE" });

    const body: unknown = await request.json().catch(() => null);
    const parsed = createServiceSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review service details.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const service = await createOrganizationService(ctx, parsed.data, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      { service },
      {
        status: 201,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
