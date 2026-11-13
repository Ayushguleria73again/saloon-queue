import { NextRequest, NextResponse } from "next/server";
import {
  createCustomerPushSubscriptionSchema,
  deleteCustomerPushSubscriptionSchema,
} from "@/features/notifications/schemas";
import { publicTokenIdParamSchema } from "@/features/public-intake/schemas";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";
import {
  revokeCustomerPushSubscription,
  upsertCustomerPushSubscription,
} from "@/server/services/customer-notification-service";

export const dynamic = "force-dynamic";

async function enforceCustomerPushRateLimit(
  request: NextRequest,
  publicId: string,
  requestId: string,
): Promise<{ ipHash: string } | { rateLimitResponse: NextResponse }> {
  const ipHash = hashIpAddress(extractClientIp(request.headers));
  const decision = await rateLimiter.consume(
    `pub:tok:push:${publicId}:${ipHash}`,
    RATE_LIMIT_RULES.publicPushSubscribe,
  );
  if (!decision.allowed) {
    const rateResponse = jsonErrorResponse(
      new RateLimitError(
        decision.retryAfterSeconds,
        "Too many notification preference updates. Please try again later.",
      ),
      requestId,
    );
    for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
      rateResponse.headers.set(key, value);
    }
    return { rateLimitResponse: rateResponse };
  }

  return { ipHash };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const { publicId } = await context.params;
    const parsedId = publicTokenIdParamSchema.safeParse(publicId);
    if (!parsedId.success) {
      throw new ValidationError("Invalid token link.");
    }

    const limitOutcome = await enforceCustomerPushRateLimit(
      request,
      parsedId.data,
      requestId,
    );
    if ("rateLimitResponse" in limitOutcome) {
      return limitOutcome.rateLimitResponse;
    }

    let jsonBody: unknown = null;
    try {
      jsonBody = await request.json();
    } catch {
      throw new ValidationError("Invalid JSON request body.");
    }

    const parsedBody = createCustomerPushSubscriptionSchema.safeParse(jsonBody);
    if (!parsedBody.success) {
      throw new ValidationError(
        "Invalid push subscription payload.",
        parsedBody.error.flatten().fieldErrors,
      );
    }

    const result = await upsertCustomerPushSubscription({
      publicId: parsedId.data,
      input: parsedBody.data,
      ipAddressHash: limitOutcome.ipHash,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(result, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const requestId = createRequestId();

  try {
    assertSameOriginRequest(request.headers);
    const { publicId } = await context.params;
    const parsedId = publicTokenIdParamSchema.safeParse(publicId);
    if (!parsedId.success) {
      throw new ValidationError("Invalid token link.");
    }

    const limitOutcome = await enforceCustomerPushRateLimit(
      request,
      parsedId.data,
      requestId,
    );
    if ("rateLimitResponse" in limitOutcome) {
      return limitOutcome.rateLimitResponse;
    }

    const rawBody = await request.text().catch(() => "");
    let endpoint: string | undefined;
    if (rawBody.trim().length > 0) {
      let jsonBody: unknown = null;
      try {
        jsonBody = JSON.parse(rawBody);
      } catch {
        throw new ValidationError("Invalid JSON request body.");
      }

      const parsedBody = deleteCustomerPushSubscriptionSchema.safeParse(jsonBody);
      if (!parsedBody.success) {
        throw new ValidationError(
          "Invalid unsubscribe request.",
          parsedBody.error.flatten().fieldErrors,
        );
      }
      endpoint = parsedBody.data.endpoint;
    }

    const result = await revokeCustomerPushSubscription({
      publicId: parsedId.data,
      endpoint,
      ipAddressHash: limitOutcome.ipHash,
      userAgent: request.headers.get("user-agent") ?? undefined,
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
