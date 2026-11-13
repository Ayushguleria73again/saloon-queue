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

export function jsonWithEtag(
  requestHeaders: Pick<Headers, "get">,
  payload: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  const bodyJson = JSON.stringify(payload);
  const etag = `"${crypto.createHash("sha1").update(bodyJson).digest("base64url")}"`;

  if (requestHeaders.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
        ...extraHeaders,
      },
    });
  }

  return new NextResponse(bodyJson, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      ...extraHeaders,
    },
  });
}
