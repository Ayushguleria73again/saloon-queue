import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";
import { resendVerificationEmail } from "@/server/services/onboarding-service";

const resendSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  })
  .strict();

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    const ipHash = hashIpAddress(extractClientIp(request.headers));
    const decision = await rateLimiter.consume(
      `auth:resend:${ipHash}`,
      RATE_LIMIT_RULES.authRegisterSalon,
    );

    if (!decision.allowed) {
      const rateResponse = jsonErrorResponse(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many verification requests. Please wait before trying again.",
        ),
        requestId,
      );
      for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
        rateResponse.headers.set(key, value);
      }
      return rateResponse;
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = resendSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please enter a valid email address.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await resendVerificationEmail({
      email: parsed.data.email,
      ipAddressHash: ipHash,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

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
