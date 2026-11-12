import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { sanitizeCallbackUrl } from "@/features/auth/schemas";

export interface MiddlewareDecisionInput {
  pathname: string;
  search: string;
  origin: string;
  hasErrorParam: boolean;
  session: Session | null;
}

function unauthorizedJsonResponse() {
  const requestId = `req_${globalThis.crypto.randomUUID()}`;
  return NextResponse.json(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
        details: null,
        requestId,
      },
    },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

function forbiddenJsonResponse(message: string) {
  const requestId = `req_${globalThis.crypto.randomUUID()}`;
  return NextResponse.json(
    {
      error: {
        code: "FORBIDDEN",
        message,
        details: null,
        requestId,
      },
    },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

export function evaluateMiddlewareGuard(
  input: MiddlewareDecisionInput,
): NextResponse | null {
  const { pathname, search, origin, hasErrorParam, session } = input;
  const user = session?.user;
  const isAuthenticated = Boolean(user?.id);

  if (pathname.startsWith("/api/owner")) {
    if (!isAuthenticated) {
      return unauthorizedJsonResponse();
    }
    return null;
  }

  if (pathname.startsWith("/api/admin")) {
    if (!isAuthenticated) {
      return unauthorizedJsonResponse();
    }
    if (!user?.isPlatformAdmin) {
      return forbiddenJsonResponse("Platform Administrator access required.");
    }
    return null;
  }

  if (pathname.startsWith("/owner")) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/login", origin);
      const safeTarget = sanitizeCallbackUrl(`${pathname}${search}`, "/owner/dashboard");
      loginUrl.searchParams.set("callbackUrl", safeTarget);
      return NextResponse.redirect(loginUrl);
    }
    return null;
  }

  if (pathname.startsWith("/admin")) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/login", origin);
      const safeTarget = sanitizeCallbackUrl(`${pathname}${search}`, "/admin");
      loginUrl.searchParams.set("callbackUrl", safeTarget);
      return NextResponse.redirect(loginUrl);
    }
    if (!user?.isPlatformAdmin) {
      return NextResponse.redirect(new URL("/owner/dashboard", origin));
    }
    return null;
  }

  if (pathname === "/login" && isAuthenticated && !hasErrorParam) {
    const destination =
      user?.isPlatformAdmin && !user.activeOrganizationId ? "/admin" : "/owner/dashboard";
    return NextResponse.redirect(new URL(destination, origin));
  }

  return null;
}
