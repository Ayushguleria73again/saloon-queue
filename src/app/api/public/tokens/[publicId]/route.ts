import { NextRequest } from "next/server";
import { publicTokenIdParamSchema } from "@/features/public-intake/schemas";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse, jsonWithEtag } from "@/lib/http";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";
import { getPublicTokenTracking } from "@/server/services/token-tracking-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const requestId = createRequestId();

  try {
    const { publicId } = await context.params;
    const parsedId = publicTokenIdParamSchema.safeParse(publicId);
    if (!parsedId.success) {
      throw new ValidationError("Invalid token link.");
    }

    const ipHash = hashIpAddress(extractClientIp(request.headers));
    const decision = await rateLimiter.consume(
      `pub:tok:read:${ipHash}`,
      RATE_LIMIT_RULES.publicTokenRead,
    );
    if (!decision.allowed) {
      const rateResponse = jsonErrorResponse(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many status refreshes. Please pause a moment.",
        ),
        requestId,
      );
      for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
        rateResponse.headers.set(key, value);
      }
      return rateResponse;
    }

    const tracking = await getPublicTokenTracking({ publicId: parsedId.data });
    return jsonWithEtag(
      request.headers,
      tracking,
      requestId,
      buildRateLimitHeaders(decision),
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
