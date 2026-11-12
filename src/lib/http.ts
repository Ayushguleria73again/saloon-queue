import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { mapErrorToEnvelope } from "./errors";
import { logger } from "./logger";

export function createRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

export function jsonErrorResponse(error: unknown, requestId = createRequestId()) {
  const mapped = mapErrorToEnvelope(error, requestId);

  if (mapped.statusCode >= 500) {
    logger.error({ requestId, err: error }, "Unhandled server error");
  }

  return NextResponse.json(mapped.body, {
    status: mapped.statusCode,
    headers: {
      "X-Request-Id": requestId,
      ...mapped.headers,
    },
  });
}
