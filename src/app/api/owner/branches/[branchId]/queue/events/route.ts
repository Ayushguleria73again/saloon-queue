import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { createSseResponse, getRealtimeHub } from "@/server/realtime";
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

    const subscriberId = crypto.randomUUID();

    return createSseResponse({
      requestSignal: request.signal,
      onConnect: (writer) => {
        // Send initial state snapshot immediately upon connection
        void getBranchQueueOverview(ctx, branchId)
          .then((overview) => {
            const version = crypto.randomUUID();
            writer.sendEvent({
              event: "queue_snapshot",
              id: version,
              data: {
                version,
                timestamp: new Date().toISOString(),
                overview,
              },
            });
          })
          .catch(() => {
            // connection might have closed
          });

        // Subscribe to real-time single-pass snapshot fan-out
        const unsubscribe = getRealtimeHub().subscribeOwner({
          id: subscriberId,
          organizationId: ctx.organizationId,
          branchId,
          type: "OWNER",
          send: writer.sendRaw,
          close: writer.close,
        });

        return () => {
          unsubscribe();
        };
      },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}

