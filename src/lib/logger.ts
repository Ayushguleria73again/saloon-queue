import pino from "pino";

const REDACT_PATHS = [
  "password",
  "passwordHash",
  "authorization",
  "cookie",
  "AUTH_SECRET",
  "VAPID_PRIVATE_KEY",
  "p256dh",
  "auth",
  "mobileNumber",
  "*.password",
  "*.passwordHash",
  "*.mobileNumber",
  "*.p256dh",
  "*.auth",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "salonflow" },
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
});

export function createRequestLogger(
  requestId: string,
  context?: Record<string, unknown>,
) {
  return logger.child({ requestId, ...context });
}
