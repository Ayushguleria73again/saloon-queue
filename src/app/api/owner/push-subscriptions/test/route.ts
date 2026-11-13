import { NextRequest, NextResponse } from "next/server";
import { ownerTestPushSchema } from "@/features/notifications/schemas";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { assertSameOriginRequest } from "@/server/security/csrf";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";
import { triggerOwnerTestPush } from "@/server/services/owner-notification-service";

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const ctx = await authorizeTenantAction();

    const decision = await rateLimiter.consume(
      `owner:push:test:${ctx.userId}`,
      RATE_LIMIT_RULES.ownerPushTest,
    );
    if (!decision.allowed) {
      const rateResponse = jsonErrorResponse(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many test notifications. Please wait a few minutes.",
        ),
        requestId,
      );
      for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
        rateResponse.headers.set(key, value);
      }
      return rateResponse;
    }

    const rawBody = await request.text().catch(() => "");
    let subscriptionId: string | undefined;
    if (rawBody.trim().length > 0) {
      let jsonBody: unknown = null;
      try {
        jsonBody = JSON.parse(rawBody);
      } catch {
        throw new ValidationError("Invalid JSON body.");
      }
      const parsed = ownerTestPushSchema.safeParse(jsonBody);
      if (!parsed.success) {
        throw new ValidationError("Invalid test push payload.");
      }
      subscriptionId = parsed.data.subscriptionId;
    }

    const result = await triggerOwnerTestPush(ctx, { subscriptionId });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
        ...buildRateLimitHeaders(decision),
      },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
