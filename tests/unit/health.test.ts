import { describe, expect, it } from "vitest";
import { evaluateHealth } from "@/app/api/health/route";
import { checkDatabaseHealth } from "@/server/db/prisma";

describe("evaluateHealth", () => {
  it("returns 200 ok when database probe succeeds", async () => {
    const result = await evaluateHealth(async () => ({
      connected: true,
      latencyMs: 4,
    }));

    expect(result.statusCode).toBe(200);
    expect(result.payload.status).toBe("ok");
    expect(result.payload.db).toBe("connected");
    expect(result.payload.latencyMs).toBe(4);
  });

  it("returns 503 degraded without leaking raw error details when database fails", async () => {
    const result = await evaluateHealth(async () => ({
      connected: false,
      error: "secret connection detail",
    }));

    expect(result.statusCode).toBe(503);
    expect(result.payload.status).toBe("degraded");
    expect(result.payload.db).toBe("unreachable");
    expect(JSON.stringify(result.payload)).not.toContain("secret connection detail");
  });

  it("fails fast with timeout when database probe stalls", async () => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://app_runtime:pw@localhost:5434/salonflow";

    try {
      const result = await checkDatabaseHealth({
        timeoutMs: 25,
        probe: () => new Promise(() => {}),
      });

      expect(result.connected).toBe(false);
      expect(result.error).toContain("timed out");
    } finally {
      if (previousUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousUrl;
      }
    }
  });
});
