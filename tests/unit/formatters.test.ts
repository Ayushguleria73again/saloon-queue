import { describe, expect, it } from "vitest";
import { cn, formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";

describe("formatters", () => {
  it("formats integer paise to INR currency strings accurately", () => {
    expect(formatPaiseToInr(0)).toBe("₹0");
    expect(formatPaiseToInr(25000)).toBe("₹250");
    expect(formatPaiseToInr(25050)).toBe("₹250.50");
    expect(formatPaiseToInr(125000)).toBe("₹1,250");
  });

  it("formats duration minutes cleanly", () => {
    expect(formatDurationMinutes(15)).toBe("15 mins");
    expect(formatDurationMinutes(45)).toBe("45 mins");
    expect(formatDurationMinutes(60)).toBe("1h");
    expect(formatDurationMinutes(90)).toBe("1h 30m");
  });

  it("joins conditional class names safely", () => {
    expect(cn("base", false, undefined, null, "active")).toBe("base active");
  });
});
