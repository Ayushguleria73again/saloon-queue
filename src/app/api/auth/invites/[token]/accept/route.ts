import { NextRequest, NextResponse } from "next/server";
import { acceptInviteSchema } from "@/features/staff/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { acceptStaffInvite, getInvitePreview } from "@/server/services/staff-service";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const requestId = createRequestId();

  try {
    const { token } = await context.params;
    const preview = await getInvitePreview(token);

    return NextResponse.json(preview, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const requestId = createRequestId();

  try {
    const { token } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    const parsed = acceptInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Please review your password setup details.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await acceptStaffInvite(token, parsed.data, {
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
