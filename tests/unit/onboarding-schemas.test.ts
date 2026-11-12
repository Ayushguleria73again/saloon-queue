import { describe, expect, it } from "vitest";
import { createBranchSchema, updateBranchSchema } from "@/features/branches/schemas";
import { registerSalonSchema, toUrlSlug } from "@/features/onboarding/schemas";
import { inviteStaffSchema } from "@/features/staff/schemas";

describe("Phase 4 feature Zod schemas", () => {
  it("normalizes salon slugs cleanly with toUrlSlug", () => {
    expect(toUrlSlug("  Aura Grooming Co.! ")).toBe("aura-grooming-co");
    expect(toUrlSlug("Urban---Trim Studio 2")).toBe("urban-trim-studio-2");
  });

  it("validates registerSalonSchema strictly and enforces Indian phone format when supplied", () => {
    const valid = registerSalonSchema.safeParse({
      ownerName: "Neha Kapoor",
      email: "neha@salon.in",
      password: "Password!2026",
      organizationName: "Aura Salon",
      salonSlug: "aura-salon",
      phone: "9876543210",
    });
    expect(valid.success).toBe(true);

    const invalidPhone = registerSalonSchema.safeParse({
      ownerName: "Neha Kapoor",
      email: "neha@salon.in",
      password: "Password!2026",
      organizationName: "Aura Salon",
      salonSlug: "aura-salon",
      phone: "12345",
    });
    expect(invalidPhone.success).toBe(false);
  });

  it("requires at least one branchId on inviteStaffSchema when allBranches is false", () => {
    const missingBranch = inviteStaffSchema.safeParse({
      name: "Suresh",
      email: "suresh@salon.in",
      roleId: "11111111-1111-4111-8111-111111111111",
      allBranches: false,
      branchIds: [],
    });
    expect(missingBranch.success).toBe(false);

    const allBranches = inviteStaffSchema.safeParse({
      name: "Suresh",
      email: "suresh@salon.in",
      roleId: "11111111-1111-4111-8111-111111111111",
      allBranches: true,
      branchIds: [],
    });
    expect(allBranches.success).toBe(true);
  });

  it("validates branch creation and businessHours HH:MM format", () => {
    expect(
      createBranchSchema.safeParse({ name: "West Branch", slug: "west-branch" }).success,
    ).toBe(true);

    expect(
      updateBranchSchema.safeParse({
        businessHours: [
          { dayOfWeek: 1, isOpen: true, openTime: "09:30", closeTime: "21:30" },
        ],
        settings: { activeStationsCount: 3, allowCustomerCancel: false },
      }).success,
    ).toBe(true);

    expect(
      updateBranchSchema.safeParse({
        businessHours: [
          { dayOfWeek: 1, isOpen: true, openTime: "25:00", closeTime: "21:30" },
        ],
      }).success,
    ).toBe(false);
  });
});
