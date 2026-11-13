import { NextRequest } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse, jsonWithEtag } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { getBranchQueueOverview } from "@/server/services/queue-service";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid("Invalid branch identifier.");

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ branchId: string }> },
) {
  const requestId = createRequestId();

  try {
    const { branchId } = await context.params;
    if (!uuidSchema.safeParse(branchId).success) {
      throw new ValidationError("Invalid branch identifier.");
    }

    const ctx = await authorizeTenantAction({
      requiredPermission: "QUEUE_VIEW",
      branchId,
    });

    const overview = await getBranchQueueOverview(ctx, branchId);
    return jsonWithEtag(request.headers, overview, requestId);
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
