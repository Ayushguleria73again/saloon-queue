import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeTenantAction, type SessionUserClaims } from "@/server/auth";
import { branchCatalogCache } from "@/server/cache/branch-catalog-cache";
import { updateBranch } from "@/server/services/branch-service";
import {
  registerSalonOrganization,
  verifyEmailToken,
} from "@/server/services/onboarding-service";
import {
  getBranchQrPayload,
  getBranchQrPngBuffer,
  getBranchQrSvgMarkup,
  regenerateBranchQrToken,
} from "@/server/services/qr-service";

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
    "TEST_DATABASE_URL and DIRECT_URL must be configured to run Phase 10 tests",
  );
}

const TEST_ADMIN_URL = DIRECT_URL.replace(/\/[^/?]+(\?|$)/, "/salonflow_test$1");

const runtimePrisma = new PrismaClient({
  datasources: { db: { url: TEST_RUNTIME_URL } },
});

const adminTestPrisma = new PrismaClient({
  datasources: { db: { url: TEST_ADMIN_URL } },
});

async function resetTestDb() {
  branchCatalogCache.clear();
  await adminTestPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "notification_deliveries",
      "notifications",
      "notification_events",
      "push_subscriptions",
      "token_services",
      "tokens",
      "queue_counters",
      "branch_services",
      "services",
      "customers",
      "business_hours",
      "salon_settings",
      "staff_branch_access",
      "organization_members",
      "role_permissions",
      "staff_roles",
      "branches",
      "audit_logs",
      "organizations",
      "users"
    CASCADE;
  `);
}

describe("Phase 10 QrService Integration Suite", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await runtimePrisma.$disconnect();
    await adminTestPrisma.$disconnect();
  });

  it("generates scan-ready QR payloads (PNG, SVG, dataUrl), appends strict ?t token, and audits QR rotation", async () => {
    let verifyTok = "";
    const reg = await registerSalonOrganization({
      input: {
        ownerName: "QR Owner",
        email: "qr-owner@salonflow.test",
        password: "Password@123",
        organizationName: "Crown Barbers",
        salonSlug: "crown-barbers",
        branchName: "Indiranagar",
        branchSlug: "indiranagar",
        timezone: "Asia/Kolkata",
        website: "",
      },
      client: runtimePrisma,
      onVerificationTokenCreated: ({ token }) => {
        verifyTok = token;
      },
    });
    await verifyEmailToken({ token: verifyTok, client: runtimePrisma });

    const ownerSession: SessionUserClaims = {
      id: reg.userId,
      email: "qr-owner@salonflow.test",
      name: "QR Owner",
      activeOrganizationId: reg.organizationId,
      sessionVersion: 1,
      isPlatformAdmin: false,
    };

    const ctx = await authorizeTenantAction({
      session: ownerSession,
      requiredPermission: "QR_MANAGE",
      branchId: reg.branchId,
      client: runtimePrisma,
    });

    const payload = await getBranchQrPayload(ctx, reg.branchId, {
      appOrigin: "https://app.salonflow.in",
      client: runtimePrisma,
    });
    expect(payload.scanUrl).toBe(
      "https://app.salonflow.in/salon/crown-barbers/indiranagar",
    );
    expect(payload.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(payload.svgMarkup).toContain("<svg");

    const png = await getBranchQrPngBuffer(ctx, reg.branchId, {
      appOrigin: "https://app.salonflow.in",
      client: runtimePrisma,
    });
    expect(png.filename).toBe("salonflow-qr-crown-barbers-indiranagar.png");
    expect(png.buffer.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const svg = await getBranchQrSvgMarkup(ctx, reg.branchId, {
      appOrigin: "https://app.salonflow.in",
      client: runtimePrisma,
    });
    expect(svg.filename).toBe("salonflow-qr-crown-barbers-indiranagar.svg");
    expect(svg.svg).toContain("<svg");

    // Enable strict QR verification then rotate
    await updateBranch(
      await authorizeTenantAction({
        session: ownerSession,
        requiredPermission: "BRANCH_MANAGE",
        branchId: reg.branchId,
        client: runtimePrisma,
      }),
      reg.branchId,
      { settings: { requireValidQrToken: true } },
      { client: runtimePrisma },
    );

    const rotated = await regenerateBranchQrToken(ctx, reg.branchId, {
      appOrigin: "https://app.salonflow.in",
      client: runtimePrisma,
    });
    expect(rotated.qrToken).not.toBe(payload.qrToken);
    expect(rotated.requireValidQrToken).toBe(true);
    expect(rotated.scanUrl).toBe(
      `https://app.salonflow.in/salon/crown-barbers/indiranagar?t=${encodeURIComponent(rotated.qrToken)}`,
    );

    const audit = await adminTestPrisma.auditLog.findFirst({
      where: {
        organizationId: reg.organizationId,
        branchId: reg.branchId,
        action: "BRANCH_QR_ROTATED",
      },
    });
    expect(audit).not.toBeNull();
  });
});
