/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { QrStudio } from "@/features/qr/components/qr-studio";
import { LiveQueueConsole } from "@/features/queue/components/live-queue-console";
import type { BranchQueueOverviewDto } from "@/features/queue/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

function makeOverview(
  overrides: Partial<BranchQueueOverviewDto> = {},
): BranchQueueOverviewDto {
  return {
    branchId: "11111111-1111-4111-8111-111111111131",
    businessDate: "2026-11-12",
    isAcceptingTokens: true,
    queuePausedReason: null,
    activeStationsCount: 2,
    estimatedNewJoinWaitMinutes: 25,
    kpis: {
      totalTokens: 3,
      waitingCount: 1,
      calledCount: 1,
      inServiceCount: 0,
      completedCount: 1,
      skippedCount: 0,
      cancelledNoShowCount: 0,
      avgWaitMinutes: 10,
      avgServiceMinutes: 25,
      revenueInPaise: 35000,
    },
    inServiceTokens: [],
    calledTokens: [
      {
        id: "tok-called",
        publicId: "pub-called",
        tokenNumber: "A001",
        sequenceNumber: 1,
        status: "CALLED",
        source: "QR",
        customerName: "Priya",
        customerMobile: "9811122233",
        notes: null,
        totalPriceInPaise: 30000,
        totalDurationMinutes: 30,
        estimatedWaitMinutes: 0,
        peopleAhead: 0,
        queuePosition: 1,
        requeuedFromTokenId: null,
        createdAt: "2026-11-12T10:00:00.000Z",
        calledAt: "2026-11-12T10:05:00.000Z",
        serviceStartedAt: null,
        skippedAt: null,
        services: [
          {
            serviceId: "svc-1",
            serviceName: "Haircut",
            priceInPaise: 30000,
            durationMinutes: 30,
          },
        ],
      },
    ],
    waitingTokens: [
      {
        id: "tok-wait",
        publicId: "pub-wait",
        tokenNumber: "A002",
        sequenceNumber: 2,
        status: "WAITING",
        source: "QR",
        customerName: "Rahul",
        customerMobile: "9876543210",
        notes: null,
        totalPriceInPaise: 30000,
        totalDurationMinutes: 30,
        estimatedWaitMinutes: 25,
        peopleAhead: 1,
        queuePosition: 2,
        requeuedFromTokenId: null,
        createdAt: "2026-11-12T10:02:00.000Z",
        calledAt: null,
        serviceStartedAt: null,
        skippedAt: null,
        services: [
          {
            serviceId: "svc-1",
            serviceName: "Haircut",
            priceInPaise: 30000,
            durationMinutes: 30,
          },
        ],
      },
    ],
    skippedTokens: [],
    ...overrides,
  };
}

describe("Phase 10 LiveQueueConsole & QrStudio Components", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const branchOption = {
    id: "11111111-1111-4111-8111-111111111131",
    name: "Koramangala",
    slug: "koramangala",
    city: "Bengaluru",
    isActive: true,
  };

  it("hides Call Next and Pause buttons when permissions are absent, and triggers Call Next when granted", async () => {
    render(
      <ToastProvider>
        <LiveQueueConsole
          branches={[branchOption]}
          selectedBranchId={branchOption.id}
          initialOverview={makeOverview()}
          branchServices={[]}
          permissionKeys={["QUEUE_VIEW"]}
        />
      </ToastProvider>,
    );

    expect(screen.queryByRole("button", { name: /Call Next/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause Intake/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add Walk-In/i })).toBeNull();

    cleanup();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: makeOverview().waitingTokens[0] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ToastProvider>
        <LiveQueueConsole
          branches={[branchOption]}
          selectedBranchId={branchOption.id}
          initialOverview={makeOverview()}
          branchServices={[]}
          permissionKeys={["QUEUE_VIEW", "QUEUE_CALL_NEXT"]}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Call Next/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/owner/branches/${branchOption.id}/queue/call-next`,
        { method: "POST" },
      );
    });
  });

  it("renders QrStudio poster with download links and rotates QR token via confirmation modal", async () => {
    const initialQr = {
      branchId: branchOption.id,
      branchName: "Koramangala",
      branchSlug: "koramangala",
      branchCity: "Bengaluru",
      salonName: "Aura Salon",
      salonSlug: "aura-salon",
      requireValidQrToken: false,
      publicPath: "/salon/aura-salon/koramangala",
      scanUrl: "http://localhost:3000/salon/aura-salon/koramangala",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    };

    const rotatedQr = {
      ...initialQr,
      requireValidQrToken: true,
      scanUrl: "http://localhost:3000/salon/aura-salon/koramangala?t=new_tok",
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ qr: rotatedQr }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ToastProvider>
        <QrStudio
          branches={[branchOption]}
          selectedBranchId={branchOption.id}
          initialQr={initialQr}
        />
      </ToastProvider>,
    );

    expect(
      screen.getByRole("link", { name: /Download PNG/i }).getAttribute("href"),
    ).toContain("format=png");
    expect(
      screen.getByRole("link", { name: /Download SVG/i }).getAttribute("href"),
    ).toContain("format=svg");

    fireEvent.click(screen.getByRole("button", { name: /Rotate QR Code/i }));
    const confirmBtns = screen.getAllByRole("button", { name: /Rotate QR Code/i });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/owner/branches/${branchOption.id}/qr/regenerate`,
        { method: "POST" },
      );
    });
  });
});
