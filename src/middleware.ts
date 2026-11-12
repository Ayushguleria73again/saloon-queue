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

  return response ?? NextResponse.next();
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
