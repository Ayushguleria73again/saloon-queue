import crypto from "node:crypto";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  changePasswordSchema,
  parseCredentialsInput,
  sanitizeCallbackUrl,
} from "@/features/auth/schemas";
import { ForbiddenError } from "@/lib/errors";
import { evaluateMiddlewareGuard } from "@/server/auth/middleware-guard";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { assertSameOriginRequest } from "@/server/security/csrf";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import {
  MemorySlidingWindowRateLimiter,
  RATE_LIMIT_RULES,
  buildRateLimitHeaders,
  rateLimiter,
} from "@/server/security/rate-limiter";

vi.mock("@/server/auth/auth", () => ({
  handlers: {
    GET: vi.fn(),
    POST: vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "http://localhost:3000/" }), { status: 200 }),
    ),
  },
}));

vi.mock("@/server/auth/auth", () => ({
  handlers: {
    GET: vi.fn(),
    POST: vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "http://localhost:3000/" }), { status: 200 }),
    ),
  },
}));

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: new Date(Date.now() + 3600_000).toISOString(),
    user: {
      id: "11111111-1111-4111-8111-111111111101",
      email: "neha@auragrooming.local",
      name: "Neha Kapoor",
      activeOrganizationId: "11111111-1111-4111-8111-111111111100",
      sessionVersion: 1,
      isPlatformAdmin: false,
      ...overrides,
    },
  };
}

describe("Password hashing & verification", () => {
  it("hashes passwords with bcrypt and verifies matching/mismatching inputs", async () => {
    const hash = await hashPassword("SalonFlow!2026", 4);
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword("SalonFlow!2026", hash)).toBe(true);
    expect(await verifyPassword("WrongPass", hash)).toBe(false);
  });

  it("verifies legacy seeded scrypt hashes cleanly and rejects malformed hashes", async () => {
    const derived = crypto
      .scryptSync("OwnerADev!2026", "aura_owner_salt", 64)
      .toString("hex");
    const scryptHash = `scrypt:aura_owner_salt:${derived}`;

    expect(await verifyPassword("OwnerADev!2026", scryptHash)).toBe(true);
    expect(await verifyPassword("Wrong", scryptHash)).toBe(false);
    expect(await verifyPassword("OwnerADev!2026", "scrypt:bad")).toBe(false);
    expect(await verifyPassword("", scryptHash)).toBe(false);
  });
});

describe("Security helpers (IP, RateLimiter, CSRF, Schema strictness)", () => {
  it("extracts client IP and produces deterministic salted SHA-256 hashes", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "x-real-ip": "198.51.100.2",
    });

    const ip = extractClientIp(headers);
    expect(ip).toBe("203.0.113.10");

    const h1 = hashIpAddress(ip, "0123456789abcdef");
    const h2 = hashIpAddress(ip, "0123456789abcdef");
    const h3 = hashIpAddress("203.0.113.11", "0123456789abcdef");

    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it("enforces sliding window rate limits and expires oldest requests cleanly", async () => {
    const limiter = new MemorySlidingWindowRateLimiter(3);
    const rule = { limit: 2, windowMs: 10_000 };

    const d1 = await limiter.consume("ip:1", rule, 1000);
    const d2 = await limiter.consume("ip:1", rule, 2000);
    const d3 = await limiter.consume("ip:1", rule, 3000);

    expect(d1.allowed).toBe(true);
    expect(d1.remaining).toBe(1);
    expect(d2.allowed).toBe(true);
    expect(d2.remaining).toBe(0);
    expect(d3.allowed).toBe(false);
    expect(d3.retryAfterSeconds).toBeGreaterThanOrEqual(8);

    expect(buildRateLimitHeaders(d3)).toMatchObject({
      "X-RateLimit-Limit": "2",
      "X-RateLimit-Remaining": "0",
    });
    expect(buildRateLimitHeaders(d3)["Retry-After"]).toBeDefined();

    // Window slides past first attempt (ts=1000) at 11_001
    const d4 = await limiter.consume("ip:1", rule, 11_001);
    expect(d4.allowed).toBe(true);
  });

  it("validates Origin/Host parity and rejects cross-origin mutation requests", () => {
    expect(() =>
      assertSameOriginRequest(
        new Headers({ origin: "https://app.salonflow.in", host: "app.salonflow.in" }),
      ),
    ).not.toThrow();

    expect(() =>
      assertSameOriginRequest(
        new Headers({ origin: "https://evil.example", host: "app.salonflow.in" }),
      ),
    ).toThrow(ForbiddenError);
  });

  it("TI-02 schema guard rejects spoofed organizationId in auth payloads", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      organizationId: "22222222-2222-4222-8222-222222222200",
    });

    expect(parsed.success).toBe(false);
  });

  it("extracts email and password cleanly when NextAuth attaches csrfToken and callbackUrl", () => {
    const parsed = parseCredentialsInput({
      email: "  Owner@Salon.in ",
      password: "Password!2026",
      csrfToken: "csrf_123456",
      callbackUrl: "http://localhost:3000/login",
    });

    expect(parsed).toEqual({
      email: "owner@salon.in",
      password: "Password!2026",
    });
  });
});

describe("Middleware guard & callbackUrl sanitizer", () => {
  it("blocks open-redirect callback URLs", () => {
    expect(sanitizeCallbackUrl("/owner/queue?tab=waiting")).toBe(
      "/owner/queue?tab=waiting",
    );
    expect(sanitizeCallbackUrl("https://evil.com")).toBe("/owner/dashboard");
    expect(sanitizeCallbackUrl("//evil.com/steal")).toBe("/owner/dashboard");
    expect(sanitizeCallbackUrl("/\\evil.com")).toBe("/owner/dashboard");
  });

  it("rejects unauthenticated /api/owner and /api/admin requests with 401 JSON", async () => {
    const ownerRes = evaluateMiddlewareGuard({
      pathname: "/api/owner/branches",
      search: "",
      origin: "http://localhost:3000",
      hasErrorParam: false,
      session: null,
    });
    expect(ownerRes?.status).toBe(401);
    const body = (await ownerRes?.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");

    const nonAdminRes = evaluateMiddlewareGuard({
      pathname: "/api/admin/tenants",
      search: "",
      origin: "http://localhost:3000",
      hasErrorParam: false,
      session: makeSession({ isPlatformAdmin: false }),
    });
    expect(nonAdminRes?.status).toBe(403);
  });

  it("redirects unauthenticated page requests to /login with safe callbackUrl and blocks non-admins from /admin", () => {
    const unauthOwner = evaluateMiddlewareGuard({
      pathname: "/owner/queue",
      search: "?branch=1",
      origin: "http://localhost:3000",
      hasErrorParam: false,
      session: null,
    });
    expect(unauthOwner?.status).toBe(307);
    expect(unauthOwner?.headers.get("location")).toBe(
      "http://localhost:3000/login?callbackUrl=%2Fowner%2Fqueue%3Fbranch%3D1",
    );

    const nonAdminPage = evaluateMiddlewareGuard({
      pathname: "/admin",
      search: "",
      origin: "http://localhost:3000",
      hasErrorParam: false,
      session: makeSession({ isPlatformAdmin: false }),
    });
    expect(nonAdminPage?.status).toBe(307);
    expect(nonAdminPage?.headers.get("location")).toBe(
      "http://localhost:3000/owner/dashboard",
    );

    // Must not redirect loop on /login?error=SessionExpired
    const loginWithError = evaluateMiddlewareGuard({
      pathname: "/login",
      search: "?error=SessionExpired",
      origin: "http://localhost:3000",
      hasErrorParam: true,
      session: makeSession(),
    });
    expect(loginWithError).toBeNull();

    // Pure platform admin hitting /owner/dashboard must be routed to /admin
    const adminOnOwner = evaluateMiddlewareGuard({
      pathname: "/owner/dashboard",
      search: "",
      origin: "http://localhost:3000",
      hasErrorParam: false,
      session: makeSession({ isPlatformAdmin: true, activeOrganizationId: null }),
    });
    expect(adminOnOwner?.status).toBe(307);
    expect(adminOnOwner?.headers.get("location")).toBe("http://localhost:3000/admin");
  });

  it("returns NextAuth-compatible url payload on 429 rate-limited credentials callback when X-Auth-Return-Redirect is 1", async () => {
    process.env.IP_HASH_SALT = "test_ip_hash_salt_0123456789";
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");

    rateLimiter.reset();
    const testIp = "198.51.100.77";

    for (let i = 0; i < RATE_LIMIT_RULES.authLogin.limit; i += 1) {
      await POST(
        new NextRequest("http://localhost:3000/api/auth/callback/credentials", {
          method: "POST",
          headers: { "x-forwarded-for": testIp },
        }),
      );
    }

    const blockedRes = await POST(
      new NextRequest("http://localhost:3000/api/auth/callback/credentials", {
        method: "POST",
        headers: {
          "x-forwarded-for": testIp,
          "X-Auth-Return-Redirect": "1",
        },
      }),
    );

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("Retry-After")).toBeDefined();
    const json = (await blockedRes.json()) as { url?: string; error?: { code: string } };
    expect(json.url).toBe("http://localhost:3000/login?error=RateLimited");
    expect(() => new URL(json.url ?? "")).not.toThrow();
    expect(json.error?.code).toBe("RATE_LIMITED");
  });
});
