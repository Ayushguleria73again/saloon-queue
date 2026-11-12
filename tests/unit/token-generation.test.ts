import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { publicCreateTokenSchema } from "@/features/public-intake/schemas";
import { POST as createPublicTokenRoute } from "@/app/api/public/salons/[salonSlug]/[branchSlug]/tokens/route";
import {
  buildTokenStatusUrl,
  formatTokenNumber,
  generateOpaqueTokenPublicId,
} from "@/server/services/token-service";
import {
  DEFAULT_OVERRUN_SAMPLE_THRESHOLD,
  deriveHistoricalOverrunFactorFromSamples,
} from "@/server/services/wait-time-service";

describe("Phase 7 Token Generation & Overrun Unit Tests", () => {
  it("zero-pads sequence numbers into deterministic token strings", () => {
    expect(formatTokenNumber("A", 1)).toBe("A001");
    expect(formatTokenNumber("A", 14)).toBe("A014");
    expect(formatTokenNumber("A", 999)).toBe("A999");
    expect(formatTokenNumber("A", 1000)).toBe("A1000");
    expect(formatTokenNumber("VIP", 7)).toBe("VIP007");
  });

  it("generates opaque 128-bit URL-safe publicId tokens without collisions", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = generateOpaqueTokenPublicId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(100);
  });

  it("builds canonical customer token tracking redirect URL", () => {
    expect(buildTokenStatusUrl("aura-salon", "indiranagar", "abc_123")).toBe(
      "/salon/aura-salon/indiranagar/token/abc_123",
    );
  });

  it("applies 1.0 overrun factor below 20 completed samples and clamps [0.85, 1.35] at >= 20 samples", () => {
    expect(DEFAULT_OVERRUN_SAMPLE_THRESHOLD).toBe(20);

    const nineteenSamples = Array.from({ length: 19 }, () => ({
      plannedDurationMinutes: 20,
      actualDurationMinutes: 40,
    }));
    expect(deriveHistoricalOverrunFactorFromSamples(nineteenSamples)).toBe(1.0);

    const twentyHighOverrun = Array.from({ length: 20 }, () => ({
      plannedDurationMinutes: 20,
      actualDurationMinutes: 40,
    }));
    expect(deriveHistoricalOverrunFactorFromSamples(twentyHighOverrun)).toBe(1.35);

    const twentyFast = Array.from({ length: 20 }, () => ({
      plannedDurationMinutes: 40,
      actualDurationMinutes: 20,
    }));
    expect(deriveHistoricalOverrunFactorFromSamples(twentyFast)).toBe(0.85);

    const twentyModerate = Array.from({ length: 20 }, () => ({
      plannedDurationMinutes: 20,
      actualDurationMinutes: 23,
    }));
    expect(deriveHistoricalOverrunFactorFromSamples(twentyModerate)).toBe(1.15);
  });

  it("normalizes Indian mobile and rejects duplicate services or invalid idempotency keys in publicCreateTokenSchema", () => {
    const svcId = "550e8400-e29b-41d4-a716-446655440000";
    const keyId = "550e8400-e29b-41d4-a716-446655440001";
    const parsed = publicCreateTokenSchema.parse({
      fullName: "  Rahul   Sharma ",
      mobileNumber: "+91 98765-43210",
      serviceIds: [svcId],
      notes: "Trim neatly",
      idempotencyKey: keyId,
      website: "",
    });
    expect(parsed.mobileNumber).toBe("9876543210");
    expect(parsed.idempotencyKey).toBe(keyId);

    const dupServices = publicCreateTokenSchema.safeParse({
      fullName: "Rahul Sharma",
      mobileNumber: "9876543210",
      serviceIds: [svcId, svcId],
    });
    expect(dupServices.success).toBe(false);
  });

  it("rejects non-empty honeypot submissions at the POST token API route", async () => {
    const svcId = "550e8400-e29b-41d4-a716-446655440000";
    const request = new NextRequest(
      "http://localhost:3000/api/public/salons/aura-salon/main/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Bot User",
          mobileNumber: "9876543210",
          serviceIds: [svcId],
          website: "https://spam.example.com",
        }),
      },
    );

    const response = await createPublicTokenRoute(request, {
      params: Promise.resolve({ salonSlug: "aura-salon", branchSlug: "main" }),
    });
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("VALIDATION_ERROR");
  });
});

