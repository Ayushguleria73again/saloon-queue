import { NextResponse } from "next/server";
import { checkDatabaseHealth, type DatabaseHealthResult } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export interface HealthPayload {
  status: "ok" | "degraded";
  service: "salonflow";
  db: "connected" | "unreachable";
  latencyMs?: number;
  timestamp: string;
}

export async function evaluateHealth(
  checkDb: () => Promise<DatabaseHealthResult> = checkDatabaseHealth,
): Promise<{ statusCode: number; payload: HealthPayload }> {
  const dbResult = await checkDb();
  const timestamp = new Date().toISOString();

  if (dbResult.connected) {
    return {
      statusCode: 200,
      payload: {
        status: "ok",
        service: "salonflow",
        db: "connected",
        latencyMs: dbResult.latencyMs,
        timestamp,
      },
    };
  }

  return {
    statusCode: 503,
    payload: {
      status: "degraded",
      service: "salonflow",
      db: "unreachable",
      timestamp,
    },
  };
}

export async function GET() {
  const { statusCode, payload } = await evaluateHealth();
  return NextResponse.json(payload, {
    status: statusCode,
    headers: { "Cache-Control": "no-store" },
  });
}
