import { describe, expect, it } from "vitest";
import {
  createServiceSchema,
  upsertBranchServiceSchema,
} from "@/features/services/schemas";
import {
  BranchCatalogCache,
  type EffectiveBranchServiceItem,
} from "@/server/cache/branch-catalog-cache";

function sampleItems(priceInPaise: number): EffectiveBranchServiceItem[] {
  return [
    {
      serviceId: "svc-1",
      name: "Haircut",
      description: null,
      priceInPaise,
      durationMinutes: 30,
      sortOrder: 0,
    },
  ];
}

describe("BranchCatalogCache & Service Schemas", () => {
  it("caches per branch, expires at TTL, and invalidates by branch or organization", () => {
    const cache = new BranchCatalogCache(20_000, 3);

    cache.set("org-a", "branch-1", sampleItems(30000), 1_000);
    cache.set("org-a", "branch-2", sampleItems(35000), 1_000);
    cache.set("org-b", "branch-3", sampleItems(40000), 1_000);

    expect(cache.get("org-a", "branch-1", 5_000)?.[0]?.priceInPaise).toBe(30000);
    expect(cache.get("org-a", "branch-1", 21_000)).toBeNull();

    // Branch-level invalidation preserves sibling branch cache
    cache.set("org-a", "branch-1", sampleItems(30000), 25_000);
    cache.invalidateBranch("org-a", "branch-1");
    expect(cache.get("org-a", "branch-1", 25_100)).toBeNull();
    expect(cache.get("org-a", "branch-2", 5_000)?.[0]?.priceInPaise).toBe(35000);

    // Org-level invalidation clears all org branches but preserves Org B
    cache.set("org-a", "branch-1", sampleItems(30000), 25_000);
    cache.set("org-a", "branch-2", sampleItems(35000), 25_000);
    cache.set("org-b", "branch-3", sampleItems(40000), 25_000);
    cache.invalidateOrganization("org-a");

    expect(cache.get("org-a", "branch-1", 25_100)).toBeNull();
    expect(cache.get("org-a", "branch-2", 25_100)).toBeNull();
    expect(cache.get("org-b", "branch-3", 25_100)?.[0]?.priceInPaise).toBe(40000);
  });

  it("evicts least recently used entry when exceeding max capacity", () => {
    const cache = new BranchCatalogCache(20_000, 2);
    cache.set("org-1", "b1", sampleItems(100), 1_000);
    cache.set("org-2", "b2", sampleItems(200), 1_000);
    // Access b1 so b2 becomes least recently used
    expect(cache.get("org-1", "b1", 1_100)?.[0]?.priceInPaise).toBe(100);

    cache.set("org-3", "b3", sampleItems(300), 1_200);
    expect(cache.get("org-2", "b2", 1_300)).toBeNull();
    expect(cache.get("org-1", "b1", 1_300)?.[0]?.priceInPaise).toBe(100);
    expect(cache.get("org-3", "b3", 1_300)?.[0]?.priceInPaise).toBe(300);
  });

  it("validates integer paise, positive duration, and nullable overrides strictly", () => {
    expect(
      createServiceSchema.safeParse({
        name: "Beard Trim",
        basePriceInPaise: 15000,
        baseDurationMinutes: 15,
      }).success,
    ).toBe(true);

    expect(
      createServiceSchema.safeParse({
        name: "Bad Price",
        basePriceInPaise: -1,
        baseDurationMinutes: 15,
      }).success,
    ).toBe(false);

    expect(
      upsertBranchServiceSchema.safeParse({
        isAvailable: true,
        priceOverrideInPaise: null,
        durationOverrideMinutes: 45,
      }).success,
    ).toBe(true);
  });
});
