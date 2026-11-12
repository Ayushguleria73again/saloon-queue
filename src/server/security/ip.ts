import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

export function extractClientIp(headers: Pick<Headers, "get">): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "127.0.0.1";
}

export function hashIpAddress(ipAddress: string, salt?: string): string {
  const resolvedSalt = salt ?? process.env.IP_HASH_SALT ?? getEnv().IP_HASH_SALT;
  return crypto.createHmac("sha256", resolvedSalt).update(ipAddress.trim()).digest("hex");
}
