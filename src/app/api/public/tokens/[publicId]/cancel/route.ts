import { NextRequest, NextResponse } from "next/server";
import {
  publicCancelTokenSchema,
  publicTokenIdParamSchema,
} from "@/features/public-intake/schemas";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";
import { cancelPublicToken } from "@/server/services/token-tracking-service";

export const dynamic = "force-dynamic";

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

    const ipHash = hashIpAddress(extractClientIp(request.headers));
    const decision = await rateLimiter.consume(
      `pub:tok:cancel:${parsedId.data}:${ipHash}`,
      RATE_LIMIT_RULES.publicTokenCancel,
    );
    if (!decision.allowed) {
      const rateResponse = jsonErrorResponse(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many cancellation attempts. Please wait a few minutes.",
        ),
        requestId,
      );
      for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
        rateResponse.headers.set(key, value);
      }
      return rateResponse;
    }

    const rawBody = await request.text().catch(() => "");
    let parsedReason: string | undefined;
    if (rawBody.trim().length > 0) {
      let jsonBody: unknown = null;
      try {
        jsonBody = JSON.parse(rawBody);
      } catch {
        throw new ValidationError("Invalid JSON body.");
      }
      const parsedBody = publicCancelTokenSchema.safeParse(jsonBody);
      if (!parsedBody.success) {
        throw new ValidationError(
          "Please provide a valid cancellation reason.",
          parsedBody.error.flatten().fieldErrors,
        );
      }
      parsedReason = parsedBody.data.reason;
    }

    const token = await cancelPublicToken({
      publicId: parsedId.data,
      reason: parsedReason,
      ipAddressHash: ipHash,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      { token },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          ...buildRateLimitHeaders(decision),
        },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
