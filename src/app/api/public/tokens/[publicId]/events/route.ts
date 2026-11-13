import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { publicTokenIdParamSchema } from "@/features/public-intake/schemas";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { createSseResponse, getRealtimeHub } from "@/server/realtime";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";
import {
  getPublicTokenTracking,
  resolvePublicTokenScope,
} from "@/server/services/token-tracking-service";

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
      `pub:tok:sse:${ipHash}`,
      RATE_LIMIT_RULES.publicTokenRead,
    );
    if (!decision.allowed) {
      const rateResponse = jsonErrorResponse(
        new RateLimitError(
          decision.retryAfterSeconds,
          "Too many stream connections. Please pause a moment.",
        ),
        requestId,
      );
      for (const [key, value] of Object.entries(buildRateLimitHeaders(decision))) {
        rateResponse.headers.set(key, value);
      }
      return rateResponse;
    }

    const scope = await resolvePublicTokenScope(parsedId.data);
    const tracking = await getPublicTokenTracking({ publicId: parsedId.data });

    const isTerminalStatus =
      tracking.status === "COMPLETED" ||
      tracking.status === "CANCELLED" ||
      tracking.status === "NO_SHOW";

    const subscriberId = crypto.randomUUID();

    return createSseResponse({
      requestSignal: request.signal,
      onConnect: (writer) => {
        const initialVersion = crypto.randomUUID();
        // Send initial token state immediately
        writer.sendEvent({
          event: "token_update",
          id: initialVersion,
          data: {
            publicId: tracking.publicId,
            tokenNumber: tracking.tokenNumber,
            status: tracking.status,
            queuePosition: tracking.queuePosition,
            peopleAhead: tracking.peopleAhead,
            estimatedWaitMinutes: tracking.estimatedWaitMinutes,
            totalPriceInPaise: tracking.totalPriceInPaise,
            totalDurationMinutes: tracking.totalDurationMinutes,
            updatedAt: new Date().toISOString(),
            isTerminal: isTerminalStatus,
            requeuedTo: tracking.requeuedTo,
          },
        });

        // If the token is already terminal, close stream after sending final event
        if (isTerminalStatus) {
          writer.close();
          return;
        }

        // Subscribe to real-time single-pass fan-out updates
        const unsubscribe = getRealtimeHub().subscribeCustomer({
          id: subscriberId,
          organizationId: scope.organizationId,
          branchId: scope.branchId,
          tokenId: scope.id,
          publicId: parsedId.data,
          type: "CUSTOMER",
          send: writer.sendRaw,
          close: writer.close,
        });

        return () => {
          unsubscribe();
        };
      },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
