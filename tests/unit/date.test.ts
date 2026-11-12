import { describe, expect, it } from "vitest";
import { getBusinessDateForTimezone } from "@/lib/date";

describe("getBusinessDateForTimezone", () => {
  it("computes business date in branch timezone across UTC midnight boundary", () => {
    // 2026-11-12T20:00:00Z is 2026-11-13 01:30:00 IST in Asia/Kolkata
    const utcTimestamp = new Date("2026-11-12T20:00:00.000Z");
    const istDate = getBusinessDateForTimezone("Asia/Kolkata", utcTimestamp);

    expect(istDate.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });

  it("handles pre-midnight IST timestamps cleanly on the same IST calendar date", () => {
    // 2026-11-12T18:00:00Z is 2026-11-12 23:30:00 IST
    const utcTimestamp = new Date("2026-11-12T18:00:00.000Z");
    const istDate = getBusinessDateForTimezone("Asia/Kolkata", utcTimestamp);

    expect(istDate.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });
});
