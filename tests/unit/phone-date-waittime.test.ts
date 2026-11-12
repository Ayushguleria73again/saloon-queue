import { describe, expect, it } from "vitest";
import { publicCreateTokenSchema } from "@/features/public-intake/schemas";
import { ValidationError } from "@/lib/errors";
import { getBusinessDateForTimezone, isWithinBusinessHours } from "@/lib/date";
import {
  maskMobileNumber,
  normalizeIndianMobile,
  tryNormalizeIndianMobile,
} from "@/lib/phone";
import { calculateBranchWaitTimes } from "@/lib/wait-time";

describe("Indian Phone Normalization (UT-PHN-01..04)", () => {
  it("normalizes +91, 0-prefixed, and formatted 10-digit Indian mobile numbers", () => {
    expect(normalizeIndianMobile("+91 98765-43210")).toBe("9876543210");
    expect(normalizeIndianMobile("09876543210")).toBe("9876543210");
    expect(normalizeIndianMobile(" 919876543210 ")).toBe("9876543210");
    expect(normalizeIndianMobile("6000012345")).toBe("6000012345");
  });

  it("rejects numbers not starting with 6-9, wrong lengths, or letters", () => {
    expect(tryNormalizeIndianMobile("5876543210")).toBeNull();
    expect(tryNormalizeIndianMobile("98765")).toBeNull();
    expect(tryNormalizeIndianMobile("9876543210a")).toBeNull();
    expect(() => normalizeIndianMobile("5876543210")).toThrow(ValidationError);
  });

  it("masks mobile numbers for public ticket display", () => {
    expect(maskMobileNumber("9876543210")).toBe("******3210");
  });

  it("validates publicCreateTokenSchema cleanly and strips control characters", () => {
    const parsed = publicCreateTokenSchema.safeParse({
      fullName: "  Rahul\u0000Sharma ",
      mobileNumber: "+91 98765 43210",
      serviceIds: ["11111111-1111-4111-8111-111111111141"],
      notes: "Short fade\nplease",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.fullName).toBe("Rahul Sharma");
      expect(parsed.data.mobileNumber).toBe("9876543210");
      expect(parsed.data.notes).toBe("Short fade please");
    }
  });
});

describe("Timezone Business Date & Hours (UT-DAT-01..03)", () => {
  it("handles Asia/Kolkata vs America/New_York and dayResetTime rollover", () => {
    // 2026-11-12T20:00:00Z -> 2026-11-13 01:30 IST / 2026-11-12 15:00 EST
    const ts = new Date("2026-11-12T20:00:00.000Z");

    expect(getBusinessDateForTimezone("Asia/Kolkata", ts, "00:00").toISOString()).toBe(
      "2026-11-13T00:00:00.000Z",
    );
    expect(getBusinessDateForTimezone("Asia/Kolkata", ts, "04:00").toISOString()).toBe(
      "2026-11-12T00:00:00.000Z",
    );
    expect(
      getBusinessDateForTimezone("America/New_York", ts, "00:00").toISOString(),
    ).toBe("2026-11-12T00:00:00.000Z");
  });

  it("checks open/close and optional break windows accurately", () => {
    const window = {
      isOpen: true,
      openTime: "09:30",
      closeTime: "21:30",
      breakStartTime: "13:30",
      breakEndTime: "14:00",
    };

    expect(isWithinBusinessHours(window, "09:29")).toBe(false);
    expect(isWithinBusinessHours(window, "09:30")).toBe(true);
    expect(isWithinBusinessHours(window, "13:45")).toBe(false);
    expect(isWithinBusinessHours(window, "14:00")).toBe(true);
    expect(isWithinBusinessHours(window, "21:30")).toBe(false);
    expect(isWithinBusinessHours({ ...window, isOpen: false }, "11:00")).toBe(false);
  });
});

describe("Waiting Time Simulator (UT-WT-01..04)", () => {
  it("returns 0 mins for an empty queue", () => {
    const result = calculateBranchWaitTimes({
      activeStationsCount: 2,
      inServiceTokens: [],
      calledTokens: [],
      waitingTokens: [],
    });

    expect(result.estimatedNewJoinWaitMinutes).toBe(0);
    expect(result.byTokenId.size).toBe(0);
  });

  it("simulates multi-station FIFO completion times and floors overdue IN_SERVICE at 3 mins", () => {
    const now = new Date("2026-11-12T12:00:00.000Z");

    const result = calculateBranchWaitTimes({
      activeStationsCount: 2,
      now,
      inServiceTokens: [
        // Overdue 40m into a 30m service -> floored at 3m
        {
          id: "in-1",
          totalDurationMinutes: 30,
          serviceStartedAt: new Date("2026-11-12T11:20:00.000Z"),
        },
        // 10m into a 25m service -> 15m remaining
        {
          id: "in-2",
          totalDurationMinutes: 25,
          serviceStartedAt: new Date("2026-11-12T11:50:00.000Z"),
        },
      ],
      calledTokens: [{ id: "cal-1", totalDurationMinutes: 20 }],
      waitingTokens: [
        { id: "w-1", totalDurationMinutes: 30 },
        { id: "w-2", totalDurationMinutes: 15 },
      ],
    });

    // cal-1 takes earliest station (3m) -> display 0, station becomes 23m
    expect(result.byTokenId.get("cal-1")?.estimatedWaitMinutes).toBe(0);
    // w-1 takes earliest station (15m vs 23m) -> wait 15m, station becomes 45m
    expect(result.byTokenId.get("w-1")).toMatchObject({
      estimatedWaitMinutes: 15,
      peopleAhead: 1,
      queuePosition: 2,
    });
    // w-2 takes earliest station (23m vs 45m) -> wait 23m, station becomes 38m
    expect(result.byTokenId.get("w-2")).toMatchObject({
      estimatedWaitMinutes: 23,
      peopleAhead: 2,
      queuePosition: 3,
    });
    // New join would wait min(38, 45) = 38m
    expect(result.estimatedNewJoinWaitMinutes).toBe(38);
  });
});
