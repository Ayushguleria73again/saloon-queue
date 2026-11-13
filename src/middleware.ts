import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/server/auth/auth.config";
import { evaluateMiddlewareGuard } from "@/server/auth/middleware-guard";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const response = evaluateMiddlewareGuard({
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
    origin: req.nextUrl.origin,
    hasErrorParam:
      req.nextUrl.searchParams.has("error") || req.nextUrl.searchParams.has("reauth"),
    session: req.auth,
  });

  const res = response ?? NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none';",
  );

  return res;
});

export const config = {
  matcher: [
    "/owner/:path*",
    "/admin/:path*",
    "/api/owner/:path*",
    "/api/admin/:path*",
    "/login",
  ],
};
