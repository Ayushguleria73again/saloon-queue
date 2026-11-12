import crypto from "node:crypto";

/**
 * Generates a URL-safe high-entropy opaque token (`base64url`).
 */
export function generateOpaqueToken(byteLength = 24): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

/**
 * Computes a deterministic SHA-256 hex digest for storing verification/invite
 * tokens safely in PostgreSQL without storing raw secret tokens.
 */
export function hashVerificationToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
