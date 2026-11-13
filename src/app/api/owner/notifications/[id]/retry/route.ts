import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { retryOwnerNotification } from "@/server/services/owner-notification-service";

const uuidSchema = z.string().uuid("Invalid notification identifier.");

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) {
      throw new ValidationError("Invalid notification identifier.");
    }

    const ctx = await authorizeTenantAction();
    const result = await retryOwnerNotification(ctx, id);

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
