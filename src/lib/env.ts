import { z } from "zod";

const emptyAsUndefined = (val: unknown) => (val === "" ? undefined : val);

const booleanString = (defaultValue: boolean) =>
  z.preprocess(
    (val) => (val === "" || val === undefined ? (defaultValue ? "true" : "false") : val),
    z.enum(["true", "false", "1", "0"]).transform((val) => val === "true" || val === "1"),
  );

const postgresUrlSchema = z
  .string()
  .url()
  .refine(
    (val) => val.startsWith("postgresql://") || val.startsWith("postgres://"),
    "Must be a PostgreSQL connection string (postgresql:// or postgres://)",
  );

const optionalPostgresUrlSchema = z.preprocess(
  emptyAsUndefined,
  postgresUrlSchema.optional(),
);

export const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyAsUndefined,
    z.enum(["development", "production", "test"]).default("development"),
  ),
  LOG_LEVEL: z.preprocess(
    emptyAsUndefined,
    z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ),

  DATABASE_URL: postgresUrlSchema,
  DIRECT_URL: optionalPostgresUrlSchema,
  TEST_DATABASE_URL: optionalPostgresUrlSchema,

  NEXT_PUBLIC_APP_URL: z.preprocess(
    emptyAsUndefined,
    z.string().url().default("http://localhost:3000"),
  ),
  AUTH_URL: z.preprocess(
    emptyAsUndefined,
    z.string().url().default("http://localhost:3000"),
  ),

  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters for secure session encryption"),
  IP_HASH_SALT: z.string().min(16, "IP_HASH_SALT must be at least 16 characters"),
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters"),

  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.preprocess(
    emptyAsUndefined,
    z.string().default("mailto:alerts@salonflow.local"),
  ),

  REALTIME_TRANSPORT: z.preprocess(
    emptyAsUndefined,
    z.enum(["memory", "pg-listen"]).default("memory"),
  ),
  OUTBOX_WORKER_ENABLED: booleanString(true),
  OUTBOX_POLL_INTERVAL_MS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(500).max(60000).default(5000),
  ),

  REQUIRE_ADMIN_TENANT_APPROVAL: booleanString(false),
  PII_RETENTION_DAYS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(30).max(3650).default(180),
  ),
});

export type AppEnv = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  readonly issues: Record<string, string[] | undefined>;

  constructor(issues: Record<string, string[] | undefined>) {
    const keys = Object.keys(issues).join(", ");
    super(`Invalid environment configuration for keys: ${keys}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export function parseEnv(rawEnv: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    throw new EnvValidationError(result.error.flatten().fieldErrors);
  }
  return result.data;
}

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}

export function resetEnvCacheForTesting(): void {
  cachedEnv = null;
}
