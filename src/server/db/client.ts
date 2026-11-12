import { PrismaClient } from "@prisma/client";
import { APP_CONFIG } from "@/lib/config";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  __salonflowInternalPrisma?: PrismaClient;
};

function createInternalPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { level: "query", emit: "event" },
      { level: "error", emit: "event" },
      { level: "warn", emit: "event" },
    ],
  });

  client.$on("query", (event) => {
    if (event.duration > APP_CONFIG.slowQueryWarnMs) {
      logger.warn(
        { module: "prisma", durationMs: event.duration },
        "Slow database query exceeded threshold",
      );
    }
  });

  client.$on("error", (event) => {
    logger.error({ module: "prisma", message: event.message }, "Prisma client error");
  });

  return client;
}

/**
 * Internal Prisma singleton. Must NOT be imported outside `src/server/db/`.
 * Business services must access data through `withTenantDb` or `withBranchDb`.
 */
export const internalPrisma =
  globalForPrisma.__salonflowInternalPrisma ?? createInternalPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__salonflowInternalPrisma = internalPrisma;
}
