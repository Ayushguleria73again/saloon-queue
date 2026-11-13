import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { UnauthorizedError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { runNotificationOutboxBatch } from "@/server/notifications/outbox-worker";

function isAuthorizedCronSecret(authHeader: string | null): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const provided = authHeader.slice("Bearer ".length).trim();
  const expected = getEnv().CRON_SECRET;

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    if (!isAuthorizedCronSecret(request.headers.get("authorization"))) {
      throw new UnauthorizedError("Invalid job processor secret.");
    }

    const summary = await runNotificationOutboxBatch({ batchSize: 50 });
    return NextResponse.json(
      { ok: true, summary },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
