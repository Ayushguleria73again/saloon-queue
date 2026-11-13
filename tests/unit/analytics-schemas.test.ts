import { describe, expect, it } from "vitest";
import { analyticsQuerySchema } from "@/features/analytics/schemas";
import { computeDateRangeBounds } from "@/server/services/analytics-service";

describe("Phase 14: Analytics Zod Schemas & Range Calculations", () => {
  it("defaults to 7d range when no query params are provided", () => {
    const parsed = analyticsQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.range).toBe("7d");
    expect(parsed.data.branchId).toBeUndefined();
  });

  it("transforms 'all' branchId to undefined", () => {
    const parsed = analyticsQuerySchema.safeParse({ branchId: "all" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.branchId).toBeUndefined();
  });

  it("validates a specific valid UUID branchId", () => {
    const validUuid = "11111111-2222-4333-8444-555555555555";
    const parsed = analyticsQuerySchema.safeParse({ branchId: validUuid });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.branchId).toBe(validUuid);
  });

  it("rejects an invalid branchId that is not a UUID", () => {
    const parsed = analyticsQuerySchema.safeParse({ branchId: "invalid-branch-id" });
    expect(parsed.success).toBe(false);
  });

  it("requires both 'from' and 'to' dates when range is 'custom'", () => {
    const missingTo = analyticsQuerySchema.safeParse({
      range: "custom",
      from: "2026-11-01",
    });
    expect(missingTo.success).toBe(false);

    const validCustom = analyticsQuerySchema.safeParse({
      range: "custom",
      from: "2026-11-01",
      to: "2026-11-10",
    });
    expect(validCustom.success).toBe(true);
  });

  it("rejects custom range where 'from' date is after 'to' date", () => {
    const invalidOrder = analyticsQuerySchema.safeParse({
      range: "custom",
      from: "2026-11-15",
      to: "2026-11-10",
    });
    expect(invalidOrder.success).toBe(false);
  });

  it("computes accurate date bounds for 'today', '7d', '30d', '90d', and 'custom'", () => {
    const anchorNow = new Date("2026-11-13T12:00:00.000Z");

    const todayBounds = computeDateRangeBounds({ range: "today" }, anchorNow);
    expect(todayBounds.range).toBe("today");
    expect(todayBounds.fromIso).toBe("2026-11-13");
    expect(todayBounds.toIso).toBe("2026-11-13");
    expect(todayBounds.granularity).toBe("day");

    const sevenDaysBounds = computeDateRangeBounds({ range: "7d" }, anchorNow);
    expect(sevenDaysBounds.range).toBe("7d");
    expect(sevenDaysBounds.fromIso).toBe("2026-11-07");
    expect(sevenDaysBounds.toIso).toBe("2026-11-13");
    expect(sevenDaysBounds.granularity).toBe("day");

    const thirtyDaysBounds = computeDateRangeBounds({ range: "30d" }, anchorNow);
    expect(thirtyDaysBounds.range).toBe("30d");
    expect(thirtyDaysBounds.fromIso).toBe("2026-10-15");
    expect(thirtyDaysBounds.toIso).toBe("2026-11-13");
    expect(thirtyDaysBounds.granularity).toBe("day");

    const ninetyDaysBounds = computeDateRangeBounds({ range: "90d" }, anchorNow);
    expect(ninetyDaysBounds.range).toBe("90d");
    expect(ninetyDaysBounds.fromIso).toBe("2026-08-16");
    expect(ninetyDaysBounds.toIso).toBe("2026-11-13");
    expect(ninetyDaysBounds.granularity).toBe("week");

    const customBounds = computeDateRangeBounds(
      {
        range: "custom",
        from: "2026-06-01",
        to: "2026-09-30",
      },
      anchorNow,
    );
    expect(customBounds.range).toBe("custom");
    expect(customBounds.fromIso).toBe("2026-06-01");
    expect(customBounds.toIso).toBe("2026-09-30");
    expect(customBounds.granularity).toBe("month");
  });
});
