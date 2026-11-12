import { NextRequest, NextResponse } from "next/server";
import { slugSchema } from "@/features/onboarding/schemas";
import { publicCreateTokenSchema } from "@/features/public-intake/schemas";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
  type RateLimitDecision,
} from "@/server/security/rate-limiter";
import {
  createPublicToken,
  resolvePublicBranchIdentity,
} from "@/server/services/token-service";

export const dynamic = "force-dynamic";

function buildRateLimitedResponse(
  decision: RateLimitDecision,
  message: string,
  requestId: string,
) {
  const response = jsonErrorResponse(
    new RateLimitError(decision.retryAfterSeconds, message),
    requestId,
  );
  for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
    response.headers.set(key, value);
  }
  return response;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ salonSlug: string; branchSlug: string }> },
) {
  const requestId = createRequestId();

  try {
    const { salonSlug, branchSlug } = await context.params;
    const salonParsed = slugSchema.safeParse(salonSlug);
    const branchParsed = slugSchema.safeParse(branchSlug);

    if (!salonParsed.success || !branchParsed.success) {
      throw new ValidationError("Invalid salon or branch URL.");
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = publicCreateTokenSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please check your details and selected services.",
        parsed.error.flatten().fieldErrors,
      );
    }

    if (parsed.data.website.trim().length > 0) {
      throw new ValidationError("Unable to process submission.");
    }

    const identity = await resolvePublicBranchIdentity(
      salonParsed.data,
      branchParsed.data,
    );

    const ipHash = hashIpAddress(extractClientIp(request.headers));
    const ipDecision = await rateLimiter.consume(
      `pub:tok:ip:${identity.branch.id}:${ipHash}`,
      RATE_LIMIT_RULES.publicTokenIp,
    );
    if (!ipDecision.allowed) {
      return buildRateLimitedResponse(
        ipDecision,
        "Too many token requests from this network. Please wait a few minutes.",
        requestId,
      );
    }

    const mobileDecision = await rateLimiter.consume(
      `pub:tok:mob:${identity.branch.id}:${parsed.data.mobileNumber}`,
      RATE_LIMIT_RULES.publicTokenMobile,
    );
    if (!mobileDecision.allowed) {
      return buildRateLimitedResponse(
        mobileDecision,
        "Too many submissions for this mobile number. Please wait before trying again.",
        requestId,
      );
    }

    const result = await createPublicToken({
      salonSlug: salonParsed.data,
      branchSlug: branchParsed.data,
      fullName: parsed.data.fullName,
      mobileNumber: parsed.data.mobileNumber,
      serviceIds: parsed.data.serviceIds,
      notes: parsed.data.notes,
      idempotencyKey: parsed.data.idempotencyKey,
      qrToken: parsed.data.qrToken,
      ipAddressHash: ipHash,
      userAgent: request.headers.get("user-agent") ?? undefined,
      resolvedIdentity: identity,
    });

    return NextResponse.json(
      {
        token: result.token,
        redirectUrl: result.redirectUrl,
      },
      {
        status: result.isIdempotentReplay ? 200 : 201,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          ...buildRateLimitHeaders(mobileDecision),
        },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

