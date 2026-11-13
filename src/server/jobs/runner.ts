import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runNotificationOutboxBatch } from "@/server/notifications/outbox-worker";

let pollTimer: NodeJS.Timeout | null = null;
let inFlightFlush = false;

async function drainOutboxCycle() {
  if (inFlightFlush) return;
  inFlightFlush = true;
  try {
    const summary = await runNotificationOutboxBatch({ batchSize: 20 });
    if (summary.claimed > 0) {
      logger.info(
        { module: "outbox-runner", ...summary },
        "Processed notification outbox batch",
      );
    }
  } catch (err) {
    logger.warn({ module: "outbox-runner", err }, "Outbox poll cycle failed");
  } finally {
    inFlightFlush = false;
  }
}

/**
 * Triggers non-blocking immediate dispatch when `OUTBOX_WORKER_ENABLED=true` outside test mode.
 */
export function nudgeOutboxWorker(): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  try {
    if (!getEnv().OUTBOX_WORKER_ENABLED) {
      return;
    }
  } catch {
    return;
  }

  ensureOutboxPollingStarted();
  queueMicrotask(() => {
    void drainOutboxCycle();
  });
}

export function ensureOutboxPollingStarted(): void {
  if (process.env.NODE_ENV === "test" || pollTimer) {
    return;
  }

  let intervalMs = 5000;
  try {
    const env = getEnv();
    if (!env.OUTBOX_WORKER_ENABLED) return;
    intervalMs = env.OUTBOX_POLL_INTERVAL_MS;
  } catch {
    return;
  }

  pollTimer = setInterval(() => {
    void drainOutboxCycle();
  }, intervalMs);

  if (typeof pollTimer.unref === "function") {
    pollTimer.unref();
  }
}
