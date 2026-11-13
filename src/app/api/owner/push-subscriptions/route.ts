import { NextRequest, NextResponse } from "next/server";
import {
  createOwnerPushSubscriptionSchema,
  deleteOwnerPushSubscriptionSchema,
} from "@/features/notifications/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  listOwnerPushSubscriptions,
  revokeOwnerPushSubscription,
  upsertOwnerPushSubscription,
} from "@/server/services/owner-notification-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = createRequestId();

  try {
    const ctx = await authorizeTenantAction();
    const data = await listOwnerPushSubscriptions(ctx);
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
    const ctx = await authorizeTenantAction();

    const body: unknown = await request.json().catch(() => null);
    const parsed = createOwnerPushSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Invalid browser Web Push subscription payload.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const subscription = await upsertOwnerPushSubscription(ctx, parsed.data, {
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      { subscription },
      {
        status: 201,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction();

    const body: unknown = await request.json().catch(() => null);
    const parsed = deleteOwnerPushSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Provide a subscription id or endpoint to unsubscribe.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await revokeOwnerPushSubscription(ctx, parsed.data);
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
