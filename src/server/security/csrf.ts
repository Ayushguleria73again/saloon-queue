import { ForbiddenError } from "@/lib/errors";

/**
 * Validates Origin/Host parity for authenticated state-changing requests
 * (`POST`, `PATCH`, `PUT`, `DELETE`) as defense-in-depth alongside SameSite cookies.
 */
export function assertSameOriginRequest(headers: Pick<Headers, "get">): void {
  const origin = headers.get("origin");
  if (!origin) {
    return;
  }

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) {
    throw new ForbiddenError("FORBIDDEN", "Missing host header for origin check.");
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("FORBIDDEN", "Invalid request origin.");
  }

  const expectedHost = host.split(",")[0]?.trim();
  if (!expectedHost || originHost !== expectedHost) {
    throw new ForbiddenError("FORBIDDEN", "Cross-origin state mutation blocked.");
  }
}
