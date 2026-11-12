import { NextRequest, NextResponse } from "next/server";
import { RateLimitError, mapErrorToEnvelope } from "@/lib/errors";
import { createRequestId } from "@/lib/http";
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
      const mapped = mapErrorToEnvelope(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many sign-in attempts. Please wait a few minutes and try again.",
        ),
        requestId,
      );

      const rateLimitHeaders = buildRateLimitHeaders(decision);
      const isNextAuthClient = request.headers.get("x-auth-return-redirect") === "1";

      const payload = isNextAuthClient
        ? {
            url: new URL("/login?error=RateLimited", request.nextUrl.origin).toString(),
            ...mapped.body,
          }
        : mapped.body;

      return NextResponse.json(payload, {
        status: mapped.statusCode,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          ...mapped.headers,
          ...rateLimitHeaders,
        },
      });
    }
  }

  return (await handlers.POST(request)) as NextResponse;
}
