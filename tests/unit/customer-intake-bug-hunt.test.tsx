/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerIntakeForm } from "@/features/public-intake/components/customer-intake-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe("CustomerIntakeForm Bug Hunt Regressions", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sampleServices = [
    {
      id: "11111111-1111-4111-8111-111111111141",
      name: "Classic Haircut",
      description: "Precision cut",
      priceInPaise: 30000,
      durationMinutes: 30,
    },
  ];

  it("BUG-01: displays real JSON 404 error message instead of stale Phase 6 placeholder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "RESOURCE_NOT_FOUND",
            message: "Branch was not found.",
          },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CustomerIntakeForm
        salonSlug="aura"
        branchSlug="old-slug"
        branchId="11111111-1111-4111-8111-111111111131"
        services={sampleServices}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Full Name/i), {
      target: { value: "Rahul Sharma" },
    });
    fireEvent.change(screen.getByLabelText(/Mobile Number/i), {
      target: { value: "9876543210" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Classic Haircut/i }));
    fireEvent.click(screen.getByRole("button", { name: /Get Queue Token/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Branch was not found.");
      expect(alert.textContent).not.toContain("Phase 7");
    });
  });

  it("BUG-02: generates distinct v4 UUID idempotency keys across mounts when crypto.randomUUID is unavailable", async () => {
    const capturedKeys: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        idempotencyKey?: string;
      };
      if (payload.idempotencyKey) {
        capturedKeys.push(payload.idempotencyKey);
      }
      return new Response(
        JSON.stringify({
          error: {
            code: "BRANCH_NOT_ACCEPTING",
            message: "Queue is paused.",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    // Simulate non-HTTPS LAN browser context where randomUUID is undefined
    const cryptoObj = globalThis.crypto;
    const originalRandomUuid = cryptoObj.randomUUID;
    Object.defineProperty(cryptoObj, "randomUUID", {
      value: undefined,
      configurable: true,
    });

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        render(
          <CustomerIntakeForm
            salonSlug="aura"
            branchSlug="koramangala"
            branchId="11111111-1111-4111-8111-111111111131"
            services={sampleServices}
          />,
        );

        fireEvent.change(screen.getByLabelText(/Full Name/i), {
          target: { value: `Customer ${attempt + 1}` },
        });
        fireEvent.change(screen.getByLabelText(/Mobile Number/i), {
          target: { value: `987654321${attempt}` },
        });
        fireEvent.click(screen.getByRole("button", { name: /Classic Haircut/i }));
        fireEvent.click(screen.getByRole("button", { name: /Get Queue Token/i }));

        await waitFor(() => {
          expect(capturedKeys).toHaveLength(attempt + 1);
        });
        cleanup();
      }
    } finally {
      Object.defineProperty(cryptoObj, "randomUUID", {
        value: originalRandomUuid,
        configurable: true,
      });
    }

    expect(capturedKeys[0]).not.toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(capturedKeys[1]).not.toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });
});
