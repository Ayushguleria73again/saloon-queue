import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateHealth } from "@/app/api/health/route";
import { checkDatabaseHealth } from "@/server/db";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

describe("Database Health Integration", () => {
  it("verifies live PostgreSQL connectivity via checkDatabaseHealth and evaluateHealth", async () => {
    const health = await evaluateHealth(checkDatabaseHealth);

    expect(health.statusCode).toBe(200);
    expect(health.payload.status).toBe("ok");
    expect(health.payload.db).toBe("connected");
    expect(typeof health.payload.latencyMs).toBe("number");
  });
});
