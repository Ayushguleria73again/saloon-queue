export interface EffectiveBranchServiceItem {
  serviceId: string;
  name: string;
  description: string | null;
  priceInPaise: number;
  durationMinutes: number;
  sortOrder: number;
}

interface CacheEntry {
  organizationId: string;
  branchId: string;
  items: EffectiveBranchServiceItem[];
  expiresAt: number;
}

const DEFAULT_TTL_MS = 20_000;
const MAX_CACHE_ENTRIES = 1_000;

export class BranchCatalogCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly orgKeys = new Map<string, Set<string>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS, maxEntries: number = MAX_CACHE_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  private static makeKey(organizationId: string, branchId: string): string {
    return `${organizationId}:${branchId}`;
  }

  get(
    organizationId: string,
    branchId: string,
    nowMs: number = Date.now(),
  ): EffectiveBranchServiceItem[] | null {
    const key = BranchCatalogCache.makeKey(organizationId, branchId);
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= nowMs) {
      this.deleteKey(key, entry.organizationId);
      return null;
    }

    // Refresh LRU order
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.items;
  }

  set(
    organizationId: string,
    branchId: string,
    items: EffectiveBranchServiceItem[],
    nowMs: number = Date.now(),
  ): void {
    const key = BranchCatalogCache.makeKey(organizationId, branchId);
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, {
      organizationId,
      branchId,
      items,
      expiresAt: nowMs + this.ttlMs,
    });

    let orgSet = this.orgKeys.get(organizationId);
    if (!orgSet) {
      orgSet = new Set();
      this.orgKeys.set(organizationId, orgSet);
    }
    orgSet.add(key);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.deleteKey(oldestKey, oldest?.organizationId);
    }
  }

  invalidateBranch(organizationId: string, branchId: string): void {
    const key = BranchCatalogCache.makeKey(organizationId, branchId);
    this.deleteKey(key, organizationId);
  }

  invalidateOrganization(organizationId: string): void {
    const keys = this.orgKeys.get(organizationId);
    if (!keys) return;

    for (const key of keys) {
      this.entries.delete(key);
    }
    this.orgKeys.delete(organizationId);
  }

  clear(): void {
    this.entries.clear();
    this.orgKeys.clear();
  }

  private deleteKey(key: string, organizationId?: string): void {
    this.entries.delete(key);
    if (!organizationId) return;

    const orgSet = this.orgKeys.get(organizationId);
    if (orgSet) {
      orgSet.delete(key);
      if (orgSet.size === 0) {
        this.orgKeys.delete(organizationId);
      }
    }
  }
}

const globalForCatalogCache = globalThis as unknown as {
  __salonflowBranchCatalogCache?: BranchCatalogCache;
};

export const branchCatalogCache =
  globalForCatalogCache.__salonflowBranchCatalogCache ?? new BranchCatalogCache();

if (process.env.NODE_ENV !== "production") {
  globalForCatalogCache.__salonflowBranchCatalogCache = branchCatalogCache;
}
