import { internalPrisma } from "./client";

export interface DatabaseHealthResult {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

export interface DatabaseHealthOptions {
  timeoutMs?: number;
  probe?: () => Promise<unknown>;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 2500;

export async function checkDatabaseHealth(
  options: DatabaseHealthOptions = {},
): Promise<DatabaseHealthResult> {
  if (!process.env.DATABASE_URL) {
    return { connected: false, error: "DATABASE_URL is not configured" };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const probe = options.probe ?? (() => internalPrisma.$queryRaw`SELECT 1`);

  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Database health check timed out"));
        }, timeoutMs);
      }),
    ]);

    return {
      connected: true,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : "Database connection failed",
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
