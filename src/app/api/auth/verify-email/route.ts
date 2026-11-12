import { NextRequest, NextResponse } from "next/server";
import { verifyEmailSchema } from "@/features/onboarding/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { verifyEmailToken } from "@/server/services/onboarding-service";

export async function GET(request: NextRequest) {
  const requestId = createRequestId();

  try {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const parsed = verifyEmailSchema.safeParse({ token });
    if (!parsed.success) {
      throw new ValidationError("Verification link is invalid or malformed.");
    }

    const result = await verifyEmailToken({
      token: parsed.data.token,
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      return NextResponse.redirect(new URL("/login?verified=1", request.nextUrl.origin));
    }

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId();

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = verifyEmailSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Verification token is invalid.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await verifyEmailToken({
      token: parsed.data.token,
      ipAddressHash: hashIpAddress(extractClientIp(request.headers)),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
