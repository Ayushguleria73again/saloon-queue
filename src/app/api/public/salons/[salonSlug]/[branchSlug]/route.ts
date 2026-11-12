import { NextRequest, NextResponse } from "next/server";
import { slugSchema } from "@/features/onboarding/schemas";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { getPublicBranchSnapshot } from "@/server/services/branch-public-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ salonSlug: string; branchSlug: string }> },
) {
  const requestId = createRequestId();

  try {
    const { salonSlug, branchSlug } = await context.params;
    const salonParsed = slugSchema.safeParse(salonSlug);
    const branchParsed = slugSchema.safeParse(branchSlug);

    if (!salonParsed.success || !branchParsed.success) {
      throw new ValidationError("Invalid salon or branch URL.");
    }

    const qrToken = request.nextUrl.searchParams.get("t");
    const snapshot = await getPublicBranchSnapshot({
      salonSlug: salonParsed.data,
      branchSlug: branchParsed.data,
      qrToken,
    });

    return NextResponse.json(snapshot, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
