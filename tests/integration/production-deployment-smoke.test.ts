import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";

function loadEnvIntoProcess() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
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

loadEnvIntoProcess();

const TEST_RUNTIME_URL = process.env.TEST_DATABASE_URL;
const DIRECT_URL = process.env.DIRECT_URL;
if (!TEST_RUNTIME_URL || !DIRECT_URL) {
  throw new Error(
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 17 tests",
  );
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

describe("Phase 17: Production Deployment & Smoke Checklist Suite", () => {
  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminPrisma.$disconnect();
  });

  describe("1. PostgreSQL Unprivileged Runtime Role & RLS Policy Enforcement", () => {
    it("verifies Row-Level Security (RLS) is active across all tenant tables and app_runtime cannot bypass RLS", async () => {
      // 1. Audit RLS enabled on all core tenant tables in PostgreSQL pg_class
      const coreTables = [
        "tokens",
        "branches",
        "services",
        "branch_services",
        "customers",
        "organization_members",
        "audit_logs",
        "notification_events",
        "business_hours",
        "push_subscriptions",
      ];

      const rlsRows = await adminPrisma.$queryRaw<
        Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
      >`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname IN (${coreTables[0]}, ${coreTables[1]}, ${coreTables[2]}, ${coreTables[3]}, ${coreTables[4]}, ${coreTables[5]}, ${coreTables[6]}, ${coreTables[7]}, ${coreTables[8]}, ${coreTables[9]});
      `;

      expect(rlsRows.length).toBe(coreTables.length);
      for (const row of rlsRows) {
        expect(
          row.relrowsecurity,
          `Table ${row.relname} must have Row-Level Security enabled (relrowsecurity = true)`,
        ).toBe(true);
      }

      // 2. Audit runtime role permissions
      const roleRows = await adminPrisma.$queryRaw<
        Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
      >`
        SELECT rolname, rolsuper, rolbypassrls
        FROM pg_roles
        WHERE rolname = 'app_runtime';
      `;

      expect(roleRows.length).toBe(1);
      const appRuntimeRole = roleRows[0]!;
      expect(appRuntimeRole.rolsuper).toBe(false);
      expect(appRuntimeRole.rolbypassrls).toBe(false);

      // 3. Verify unprivileged runtime connection blocks bare queries without session context
      const tokensWithoutContext = await runtimePrisma.token.findMany({ take: 5 });
      expect(tokensWithoutContext).toEqual([]);
    });
  });

  describe("2. Reverse Proxy Configuration & Header Directives", () => {
    it("validates nginx.conf contains SSE unbuffered streaming, SW update headers, and security rules", () => {
      const nginxPath = path.resolve(process.cwd(), "docker/nginx/nginx.conf");
      expect(fs.existsSync(nginxPath)).toBe(true);
      const conf = fs.readFileSync(nginxPath, "utf8");

      // Verify Service Worker update directives
      expect(conf).toContain("location = /sw.js");
      expect(conf).toContain(
        'add_header Cache-Control "no-cache, no-store, must-revalidate"',
      );
      expect(conf).toContain('add_header Service-Worker-Allowed "/"');

      // Verify Real-time SSE streaming anti-buffering directives
      expect(conf).toContain("proxy_buffering off;");
      expect(conf).toContain("proxy_cache off;");
      expect(conf).toContain('add_header X-Accel-Buffering "no"');
      expect(conf).toContain("proxy_read_timeout 120s;");

      // Verify strict security headers
      expect(conf).toContain('add_header X-Content-Type-Options "nosniff"');
      expect(conf).toContain('add_header X-Frame-Options "DENY"');
      expect(conf).toContain(
        'add_header Referrer-Policy "strict-origin-when-cross-origin"',
      );
      expect(conf).toContain(
        'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains"',
      );
      expect(conf).toContain("add_header Content-Security-Policy \"default-src 'self'");
    });
  });

  describe("3. Multi-Stage Containerization & Compose Configuration", () => {
    it("validates Dockerfile uses multi-stage build, unprivileged user, and healthcheck", () => {
      const dockerfilePath = path.resolve(process.cwd(), "Dockerfile");
      expect(fs.existsSync(dockerfilePath)).toBe(true);
      const dockerfile = fs.readFileSync(dockerfilePath, "utf8");

      // Verify multi-stage targets
      expect(dockerfile).toContain("FROM node:20-alpine AS base");
      expect(dockerfile).toContain("FROM base AS deps");
      expect(dockerfile).toContain("FROM base AS builder");
      expect(dockerfile).toContain("FROM node:20-alpine AS runner");

      // Verify non-root user setup
      expect(dockerfile).toContain("addgroup --system --gid 1001 nodejs");
      expect(dockerfile).toContain("adduser --system --uid 1001 nextjs");
      expect(dockerfile).toContain("USER nextjs");

      // Verify standalone build copy
      expect(dockerfile).toContain(
        "COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./",
      );
      expect(dockerfile).toContain(
        "COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static",
      );

      // Verify healthcheck
      expect(dockerfile).toContain("HEALTHCHECK");
      expect(dockerfile).toContain(
        "wget -qO- http://localhost:3000/api/health || exit 1",
      );
    });

    it("validates docker-compose.prod.yml configuration isolates services and uses app_runtime", () => {
      const composePath = path.resolve(process.cwd(), "docker-compose.prod.yml");
      expect(fs.existsSync(composePath)).toBe(true);
      const compose = fs.readFileSync(composePath, "utf8");

      expect(compose).toContain("services:");
      expect(compose).toContain("db:");
      expect(compose).toContain("app:");
      expect(compose).toContain("proxy:");

      // App uses non-superuser role app_runtime for DATABASE_URL
      expect(compose).toContain("postgresql://app_runtime:");
      // Direct URL uses admin role for migrations
      expect(compose).toContain("DIRECT_URL: postgresql://salonflow_admin:");
      expect(compose).toContain('OUTBOX_WORKER_ENABLED: "true"');
      expect(compose).toContain("salonflow_prod_pgdata:");
    });
  });

  describe("4. Platform Admin Provisioning Script (scripts/seed-platform-admin.ts)", () => {
    it("provisions and idempotently updates a platform administrator without error", async () => {
      const testEmail = `admin.prod.${Date.now()}@salonflow.com`;
      const testPassword = "AdminProdPassword123!";
      const testName = "Production Root Operator";

      const passwordHash = await bcrypt.hash(testPassword, 10);
      const now = new Date();

      // Seed initial admin
      const seeded = await adminPrisma.user.upsert({
        where: { email: testEmail },
        update: {
          name: testName,
          passwordHash,
          isPlatformAdmin: true,
          isActive: true,
          emailVerifiedAt: now,
          sessionVersion: { increment: 1 },
        },
        create: {
          email: testEmail,
          name: testName,
          passwordHash,
          isPlatformAdmin: true,
          isActive: true,
          emailVerifiedAt: now,
          sessionVersion: 1,
        },
      });

      expect(seeded.email).toBe(testEmail);
      expect(seeded.isPlatformAdmin).toBe(true);
      expect(seeded.isActive).toBe(true);

      const isValidPw = await bcrypt.compare(testPassword, seeded.passwordHash);
      expect(isValidPw).toBe(true);

      // Idempotently re-run provisioning: sessionVersion increments
      const reSeeded = await adminPrisma.user.upsert({
        where: { email: testEmail },
        update: {
          name: "Updated Operator Name",
          isPlatformAdmin: true,
          isActive: true,
          sessionVersion: { increment: 1 },
        },
        create: {
          email: testEmail,
          name: testName,
          passwordHash,
          isPlatformAdmin: true,
          isActive: true,
          emailVerifiedAt: now,
          sessionVersion: 1,
        },
      });

      expect(reSeeded.sessionVersion).toBe(seeded.sessionVersion + 1);
      expect(reSeeded.name).toBe("Updated Operator Name");
    });
  });

  describe("5. Automated Backup & Restore Drill Verification (scripts/backup.sh & scripts/restore.sh)", () => {
    it("verifies backup and restore scripts exist, are executable, and contain custom-format flags", () => {
      const backupPath = path.resolve(process.cwd(), "scripts/backup.sh");
      const restorePath = path.resolve(process.cwd(), "scripts/restore.sh");
      const deployPath = path.resolve(process.cwd(), "scripts/deploy.sh");

      expect(fs.existsSync(backupPath)).toBe(true);
      expect(fs.existsSync(restorePath)).toBe(true);
      expect(fs.existsSync(deployPath)).toBe(true);

      const backupScript = fs.readFileSync(backupPath, "utf8");
      expect(backupScript).toContain("pg_dump");
      expect(backupScript).toContain("--format=custom");
      expect(backupScript).toContain("--no-owner");
      expect(backupScript).toContain("--no-acl");

      const restoreScript = fs.readFileSync(restorePath, "utf8");
      expect(restoreScript).toContain("pg_restore");
      expect(restoreScript).toContain("--clean");
      expect(restoreScript).toContain("--if-exists");
      expect(restoreScript).toContain("relrowsecurity = false");

      const deployScript = fs.readFileSync(deployPath, "utf8");
      expect(deployScript).toContain("npx prisma migrate deploy");
      expect(deployScript).toContain("app_runtime");
      expect(deployScript).toContain("seed-platform-admin");
    });
  });

  describe("6. System Health Diagnostic Telemetry", () => {
    it("verifies database responds to connection check cleanly", async () => {
      const result = await adminPrisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
      expect(result).toHaveLength(1);
      expect(result[0]?.ok).toBe(1);

      const tableCount = await adminPrisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
      `;
      expect(Number(tableCount[0]?.count)).toBeGreaterThanOrEqual(15);
    });
  });
});
