import { NextRequest, NextResponse } from "next/server";
import { registerSalonSchema } from "@/features/onboarding/schemas";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";
import { registerSalonOrganization } from "@/server/services/onboarding-service";

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    const ipHash = hashIpAddress(extractClientIp(request.headers));
    const decision = await rateLimiter.consume(
      `auth:register:${ipHash}`,
      RATE_LIMIT_RULES.authRegisterSalon,
    );

    if (!decision.allowed) {
      const rateResponse = jsonErrorResponse(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many salon registrations from this network. Please try again later.",
        ),
        requestId,
      );
      for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
        rateResponse.headers.set(key, value);
      }
      return rateResponse;
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = registerSalonSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review your salon registration details.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await registerSalonOrganization({
      input: parsed.data,
      ipAddressHash: ipHash,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      ...buildRateLimitHeaders(decision),
    };

    return NextResponse.json(result, { status: 201, headers });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
