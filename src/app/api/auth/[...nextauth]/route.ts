import { NextRequest, NextResponse } from "next/server";
import { RateLimitError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { handlers } from "@/server/auth/auth";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";

export const { GET } = handlers;

export async function POST(request: NextRequest) {
  if (request.nextUrl.pathname.endsWith("/callback/credentials")) {
    const ipHash = hashIpAddress(extractClientIp(request.headers));
    const decision = await rateLimiter.consume(
      `auth:login:${ipHash}`,
      RATE_LIMIT_RULES.authLogin,
    );

    if (!decision.allowed) {
      const requestId = createRequestId();
      const errorResponse = jsonErrorResponse(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many sign-in attempts. Please wait a few minutes and try again.",
        ),
        requestId,
      );

      for (const [header, value] of Object.entries(buildRateLimitHeaders(decision))) {
        errorResponse.headers.set(header, value);
      }

      return errorResponse;
    }
  }

  return (await handlers.POST(request)) as NextResponse;
}
