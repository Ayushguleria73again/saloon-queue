import { NextRequest, NextResponse } from "next/server";
import { publicPushAckSchema } from "@/features/notifications/schemas";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";
import { acknowledgePublicNotification } from "@/server/services/customer-notification-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);

    const ipHash = hashIpAddress(extractClientIp(request.headers));
    const decision = await rateLimiter.consume(
      `pub:push:ack:${ipHash}`,
      RATE_LIMIT_RULES.publicTokenRead,
    );
    if (!decision.allowed) {
      const rateResponse = jsonErrorResponse(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many notification receipt callbacks.",
        ),
        requestId,
      );
      for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
        rateResponse.headers.set(key, value);
      }
      return rateResponse;
    }

    let jsonBody: unknown = null;
    try {
      jsonBody = await request.json();
    } catch {
      throw new ValidationError("Invalid JSON request body.");
    }

    const parsed = publicPushAckSchema.safeParse(jsonBody);
    if (!parsed.success) {
      throw new ValidationError(
        "Invalid notification acknowledgement payload.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await acknowledgePublicNotification({
      notificationId: parsed.data.notificationId,
      event: parsed.data.event,
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
