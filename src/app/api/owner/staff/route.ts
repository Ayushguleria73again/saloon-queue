import { NextResponse } from "next/server";
import { createRequestId, jsonErrorResponse } from "@/lib/http";
import { authorizeTenantAction } from "@/server/auth";
import { listStaffAndRoles } from "@/server/services/staff-service";

export async function GET() {
  const requestId = createRequestId();

  try {
    const ctx = await authorizeTenantAction({ requiredPermission: "STAFF_MANAGE" });
    const payload = await listStaffAndRoles(ctx);

    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    return jsonErrorResponse(error, requestId);
  }
}
