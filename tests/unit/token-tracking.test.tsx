/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenTrackerView } from "@/features/public-intake/components/token-tracker-view";
import type { PublicTokenTrackingDto } from "@/features/public-intake/types";
import { jsonWithEtag } from "@/lib/http";

function makeTrackingDto(
  overrides: Partial<PublicTokenTrackingDto> = {},
): PublicTokenTrackingDto {
  return {
    publicId: "V1StGXR8_Z5jdHi6B-myT",
    tokenNumber: "A014",
    status: "WAITING",
    customerName: "Rahul Sharma",
    maskedMobile: "******3210",
    notes: "Light fade",
    queuePosition: 2,
    peopleAhead: 1,
    estimatedWaitMinutes: 25,
    totalPriceInPaise: 30000,
    totalDurationMinutes: 30,
    canCustomerCancel: true,
    allowCustomerCancelSetting: true,
    pushAlertsEnabled: false,
    organization: { name: "Aura Grooming Co.", slug: "aura-grooming" },
    branch: {
      id: "11111111-1111-4111-8111-111111111131",
      name: "Koramangala",
      slug: "koramangala",
      city: "Bengaluru",
      address: "100 Ft Rd",
      phone: null,
      timezone: "Asia/Kolkata",
    },
    services: [{ name: "Classic Haircut", priceInPaise: 30000, durationMinutes: 30 }],
    requeuedTo: null,
    createdAt: "2026-11-12T10:00:00.000Z",
    calledAt: null,
    serviceStartedAt: null,
    completedAt: null,
    skippedAt: null,
    cancelledAt: null,
    noShowAt: null,
    ...overrides,
  };
}

describe("Phase 9 TokenTrackerView & ETag Helpers", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (typeof window.localStorage?.clear === "function") {
      window.localStorage.clear();
    }
  });

  it("renders required confirmation copy, masked mobile, metrics, and supports self-cancellation modal", async () => {
    const cancelledDto = makeTrackingDto({
      status: "CANCELLED",
      canCustomerCancel: false,
      queuePosition: 0,
      peopleAhead: 0,
      estimatedWaitMinutes: 0,
      cancelledAt: "2026-11-12T10:05:00.000Z",
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: cancelledDto }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenTrackerView initialToken={makeTrackingDto()} />);

    expect(screen.getByText("Your token has been generated successfully!")).toBeTruthy();
    expect(
      screen.getByText(
        "Please wait for your turn. We will notify you when your turn is approaching.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("A014")).toBeTruthy();
    expect(screen.getByText("******3210")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Cancel My Token/i }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, Cancel Token/i }));

    await waitFor(() => {
      expect(screen.getByText("Cancelled")).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/tokens/V1StGXR8_Z5jdHi6B-myT/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("hides self-cancel button once token is CALLED and shows re-queue banner when SKIPPED + requeued", () => {
    const { rerender } = render(
      <TokenTrackerView
        initialToken={makeTrackingDto({
          status: "CALLED",
          canCustomerCancel: false,
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: /Cancel My Token/i })).toBeNull();
    expect(
      screen.getByText(
        /Online cancellation is unavailable once your token is called or in service/i,
      ),
    ).toBeTruthy();

    rerender(
      <TokenTrackerView
        initialToken={makeTrackingDto({
          status: "SKIPPED",
          canCustomerCancel: false,
          requeuedTo: {
            publicId: "NEW_REQUEUED_PUBLIC_ID",
            tokenNumber: "A019",
            url: "/salon/aura-grooming/koramangala/token/NEW_REQUEUED_PUBLIC_ID",
          },
        })}
      />,
    );

    const link = screen.getByRole("link", { name: /Open Active Token \(A019\)/i });
    expect(link.getAttribute("href")).toBe(
      "/salon/aura-grooming/koramangala/token/NEW_REQUEUED_PUBLIC_ID",
    );
  });

  it("jsonWithEtag emits deterministic ETag on 200 and returns 304 Not Modified on matching If-None-Match", async () => {
    const payload = { tokenNumber: "A014", status: "WAITING" };
    const first = jsonWithEtag(new Headers(), payload, "req_1");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const cached = jsonWithEtag(
      new Headers({ "if-none-match": etag ?? "" }),
      payload,
      "req_2",
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get("etag")).toBe(etag);
  });

  it("E2E-03: renders post-token push opt-in without auto-prompting, handles grant & unsubscribe, and degrades gracefully on denied permission", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    const subscribe = vi.fn().mockResolvedValue({
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/customer-e2e03-dev",
        keys: {
          p256dh:
            "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          auth: "AAAAAAAAAAAAAAAAAAAAAA",
        },
      }),
    });
    const getSubscription = vi.fn().mockResolvedValue(null);
    const register = vi.fn().mockResolvedValue({
      pushManager: { getSubscription, subscribe },
    });

    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {
        register,
        ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }),
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({
              endpoint: "https://fcm.googleapis.com/fcm/send/customer-e2e03-dev",
            }),
          },
        }),
      },
    });
    vi.stubGlobal("PushManager", function PushManager() {});

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ subscribed: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <TokenTrackerView
        initialToken={makeTrackingDto({ status: "WAITING", pushAlertsEnabled: false })}
        vapidPublicKey="BOr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
      />,
    );

    // Zero browser permission dialog may fire automatically on page mount
    expect(requestPermission).not.toHaveBeenCalled();

    const enableBtn = screen.getByRole("button", { name: /Enable Notifications/i });
    fireEvent.click(enableBtn);

    await waitFor(() => {
      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/public/tokens/V1StGXR8_Z5jdHi6B-myT/push-subscription",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.getByText(/Turn alerts active for A014/i)).toBeTruthy();
    });

    // Clicking Unsubscribe Alerts calls DELETE cleanly
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ subscribed: false, revokedCount: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Unsubscribe Alerts/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/public/tokens/V1StGXR8_Z5jdHi6B-myT/push-subscription",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(screen.getByRole("button", { name: /Enable Notifications/i })).toBeTruthy();
    });

    // Denied permission never breaks live ticket tracking
    vi.stubGlobal("Notification", {
      permission: "denied",
      requestPermission,
    });
    rerender(
      <TokenTrackerView
        key="denied-case"
        initialToken={makeTrackingDto({
          publicId: "DENIED_PUBLIC_ID_001",
          status: "WAITING",
          pushAlertsEnabled: false,
        })}
        vapidPublicKey="BOr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
      />,
    );
    expect(screen.getByText(/Browser Notifications Blocked/i)).toBeTruthy();
    expect(screen.getByText("A014")).toBeTruthy();
  });
});
