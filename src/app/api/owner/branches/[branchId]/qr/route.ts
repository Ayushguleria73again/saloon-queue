import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import {
  getBranchQrPayload,
  getBranchQrPngBuffer,
  getBranchQrSvgMarkup,
} from "@/server/services/qr-service";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid("Invalid branch identifier.");
const formatSchema = z.enum(["json", "png", "svg"]).default("json");

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

    const formatParsed = formatSchema.safeParse(
      request.nextUrl.searchParams.get("format") ?? "json",
    );
    if (!formatParsed.success) {
      throw new ValidationError("Format must be json, png, or svg.");
    }

    const ctx = await authorizeTenantAction({
      requiredPermission: "QR_MANAGE",
      branchId,
    });

    const appOrigin = request.nextUrl.origin;
    const format = formatParsed.data;

    if (format === "png") {
      const { filename, buffer } = await getBranchQrPngBuffer(ctx, branchId, {
        appOrigin,
      });
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      });
    }

    if (format === "svg") {
      const { filename, svg } = await getBranchQrSvgMarkup(ctx, branchId, {
        appOrigin,
      });
      return new NextResponse(svg, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      });
    }

    const qr = await getBranchQrPayload(ctx, branchId, { appOrigin });
    return NextResponse.json(
      { qr },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
