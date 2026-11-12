import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/lib/env";

const VALID_BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  LOG_LEVEL: "warn",
  DATABASE_URL: "postgresql://app_runtime:secret@localhost:5432/salonflow",
  DIRECT_URL: "postgresql://admin:secret@localhost:5432/salonflow",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  AUTH_URL: "http://localhost:3000",
  AUTH_SECRET: "a-very-secure-32-character-random-secret-key",
  IP_HASH_SALT: "0123456789abcdef",
  CRON_SECRET: "fedcba9876543210",
};

describe("parseEnv", () => {
  it("parses valid environment configuration with defaults", () => {
    const parsed = parseEnv(VALID_BASE_ENV);

    expect(parsed.NODE_ENV).toBe("test");
    expect(parsed.REALTIME_TRANSPORT).toBe("memory");
    expect(parsed.OUTBOX_WORKER_ENABLED).toBe(true);
    expect(parsed.REQUIRE_ADMIN_TENANT_APPROVAL).toBe(false);
    expect(parsed.PII_RETENTION_DAYS).toBe(180);
  });

  it("rejects non-postgres DATABASE_URL and short AUTH_SECRET", () => {
    expect(() =>
      parseEnv({
        ...VALID_BASE_ENV,
        DATABASE_URL: "mysql://user:pass@localhost:3306/db",
        AUTH_SECRET: "too-short",
      }),
    ).toThrow(EnvValidationError);
  });

  it("coerces boolean and numeric flags accurately", () => {
    const parsed = parseEnv({
      ...VALID_BASE_ENV,
      OUTBOX_WORKER_ENABLED: "false",
      REQUIRE_ADMIN_TENANT_APPROVAL: "true",
      OUTBOX_POLL_INTERVAL_MS: "2500",
      PII_RETENTION_DAYS: "90",
    });

    expect(parsed.OUTBOX_WORKER_ENABLED).toBe(false);
    expect(parsed.REQUIRE_ADMIN_TENANT_APPROVAL).toBe(true);
    expect(parsed.OUTBOX_POLL_INTERVAL_MS).toBe(2500);
    expect(parsed.PII_RETENTION_DAYS).toBe(90);
  });

  it("treats empty-string optional URLs and boolean flags as unset defaults while rejecting invalid values", () => {
    const parsed = parseEnv({
      ...VALID_BASE_ENV,
      DIRECT_URL: "",
      TEST_DATABASE_URL: "",
      OUTBOX_WORKER_ENABLED: "",
      REQUIRE_ADMIN_TENANT_APPROVAL: "",
    });

    expect(parsed.DIRECT_URL).toBeUndefined();
    expect(parsed.TEST_DATABASE_URL).toBeUndefined();
    expect(parsed.OUTBOX_WORKER_ENABLED).toBe(true);
    expect(parsed.REQUIRE_ADMIN_TENANT_APPROVAL).toBe(false);

    expect(() =>
      parseEnv({
        ...VALID_BASE_ENV,
        OUTBOX_WORKER_ENABLED: "yes-please",
      }),
    ).toThrow(EnvValidationError);
  });
});
