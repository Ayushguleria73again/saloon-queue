#!/usr/bin/env tsx
// ==============================================================================
// SalonFlow Production Environment Secrets Validator (RELEASE_CHECKLIST.md)
// ==============================================================================

import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "../src/lib/env";

const targetFile = process.argv[2] || ".env.production";
const envPath = path.resolve(process.cwd(), targetFile);

console.log("======================================================================");
console.log(` Auditing Production Environment Secrets: ${targetFile}`);
console.log("======================================================================");

if (!fs.existsSync(envPath)) {
  console.error(`ERROR: Environment file not found at ${envPath}`);
  console.error("Please create .env.production before running production validation.");
  process.exit(1);
}

// Parse lines into temporary env object
const rawEnv: Record<string, string> = {};
const lines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const eqIdx = trimmed.indexOf("=");
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, "");
  rawEnv[key] = val;
}

const errors: string[] = [];
const warnings: string[] = [];

// 1. Zod Base Schema Validation
try {
  parseEnv(rawEnv);
  console.log("✓ Zod envSchema base validation passed.");
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  errors.push(`Zod validation failed: ${message}`);
}

// 2. Strict Production Rules
const nodeEnv = rawEnv.NODE_ENV;
if (nodeEnv !== "production") {
  warnings.push(`NODE_ENV is set to '${nodeEnv}' (expected 'production' for live release).`);
}

// Check AUTH_SECRET
const authSecret = rawEnv.AUTH_SECRET || "";
if (!authSecret) {
  errors.push("AUTH_SECRET is empty.");
} else if (authSecret.length < 32) {
  errors.push(`AUTH_SECRET length (${authSecret.length}) is below required minimum of 32 characters.`);
} else if (/change-me|dev-only|salonflow_prod_secret_key_minimum/i.test(authSecret)) {
  errors.push("AUTH_SECRET uses an insecure template placeholder! Generate with: openssl rand -base64 48");
} else {
  console.log(`✓ AUTH_SECRET is cryptographically valid (${authSecret.length} chars).`);
}

// Check IP_HASH_SALT
const ipSalt = rawEnv.IP_HASH_SALT || "";
if (!ipSalt) {
  errors.push("IP_HASH_SALT is empty.");
} else if (ipSalt.length < 16) {
  errors.push(`IP_HASH_SALT length (${ipSalt.length}) is below required minimum of 16 characters.`);
} else if (/change-me|dev-only/i.test(ipSalt)) {
  errors.push("IP_HASH_SALT uses an insecure placeholder! Generate with: openssl rand -hex 16");
} else {
  console.log(`✓ IP_HASH_SALT is cryptographically valid (${ipSalt.length} chars).`);
}

// Check CRON_SECRET
const cronSecret = rawEnv.CRON_SECRET || "";
if (!cronSecret) {
  errors.push("CRON_SECRET is empty.");
} else if (cronSecret.length < 16) {
  errors.push(`CRON_SECRET length (${cronSecret.length}) is below required minimum of 16 characters.`);
} else if (/change-me|dev-only/i.test(cronSecret)) {
  errors.push("CRON_SECRET uses an insecure placeholder! Generate with: openssl rand -hex 16");
} else {
  console.log(`✓ CRON_SECRET is valid (${cronSecret.length} chars).`);
}

// Check DATABASE_URL for non-superuser role
const dbUrl = rawEnv.DATABASE_URL || "";
if (!dbUrl) {
  errors.push("DATABASE_URL is empty.");
} else {
  if (dbUrl.includes("://postgres:") || dbUrl.includes("://root:") || dbUrl.includes("://salonflow_admin:")) {
    errors.push("CRITICAL SECURITY VIOLATION: DATABASE_URL must NOT connect as superuser or admin role! Use unprivileged 'app_runtime' role to enforce PostgreSQL RLS.");
  } else if (!dbUrl.includes("://app_runtime:")) {
    warnings.push("DATABASE_URL does not explicitly specify 'app_runtime' role. Ensure the configured database role has NOSUPERUSER NOBYPASSRLS.");
  } else {
    console.log("✓ DATABASE_URL connects via unprivileged 'app_runtime' role (RLS enforced).");
  }
}

// Check Web Push VAPID keys
const vapidPublic = rawEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const vapidPrivate = rawEnv.VAPID_PRIVATE_KEY || "";
if (!vapidPublic || !vapidPrivate) {
  errors.push("VAPID keys are missing. Web Push requires NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Generate with: npx web-push generate-vapid-keys");
} else if (vapidPublic.length < 65 || vapidPrivate.length < 32) {
  errors.push("VAPID keys appear malformed or too short for RFC 8292 P-256 standard.");
} else {
  console.log("✓ VAPID Web Push keypair configured.");
}

// Check Public App URL & SSL
const appUrl = rawEnv.NEXT_PUBLIC_APP_URL || "";
if (!appUrl) {
  errors.push("NEXT_PUBLIC_APP_URL is empty.");
} else if (!appUrl.startsWith("https://") && nodeEnv === "production") {
  errors.push(`NEXT_PUBLIC_APP_URL ('${appUrl}') must use 'https://' in production.`);
} else {
  console.log(`✓ NEXT_PUBLIC_APP_URL configured: ${appUrl}`);
}

console.log("----------------------------------------------------------------------");
if (warnings.length > 0) {
  console.log("WARNINGS:");
  for (const w of warnings) {
    console.log(`  ! ${w}`);
  }
}

if (errors.length > 0) {
  console.error("FAILURES:");
  for (const e of errors) {
    console.error(`  ✗ ${e}`);
  }
  console.log("======================================================================");
  console.error("Production Secrets Validation: FAILED (Release Gate Blocked)");
  console.log("======================================================================");
  process.exit(1);
} else {
  console.log("======================================================================");
  console.log("Production Secrets Validation: PASSED (Release Gate Clear)");
  console.log("======================================================================");
  process.exit(0);
}
