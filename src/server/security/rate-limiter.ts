export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, rule: RateLimitRule, nowMs?: number): Promise<RateLimitDecision>;
}

export const RATE_LIMIT_RULES = {
  publicTokenIp: { limit: 20, windowMs: 10 * 60_000 },
  publicTokenMobile: { limit: 3, windowMs: 15 * 60_000 },
  publicPushSubscribe: { limit: 10, windowMs: 10 * 60_000 },
  publicTokenRead: { limit: 60, windowMs: 60_000 },
  publicTokenCancel: { limit: 5, windowMs: 5 * 60_000 },
  authLogin: { limit: 10, windowMs: 15 * 60_000 },
  authRegisterSalon: { limit: 5, windowMs: 60 * 60_000 },
  ownerPushTest: { limit: 5, windowMs: 5 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Bounded LRU sliding-window rate limiter (<0.1ms per check).
 * Evicts the least-recently-used key when `maxEntries` is exceeded.
 */
export class MemorySlidingWindowRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  async consume(
    key: string,
    rule: RateLimitRule,
    nowMs: number = Date.now(),
  ): Promise<RateLimitDecision> {
    const windowStart = nowMs - rule.windowMs;
    const existing = this.buckets.get(key) ?? [];

    // Re-insert for LRU ordering
    if (this.buckets.has(key)) {
      this.buckets.delete(key);
    }

    const active = existing.filter((ts) => ts > windowStart);

    if (active.length >= rule.limit) {
      const oldestActive = active[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, oldestActive + rule.windowMs - nowMs);
      this.buckets.set(key, active);
      this.enforceCapacity();

      return {
        allowed: false,
        limit: rule.limit,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    active.push(nowMs);
    this.buckets.set(key, active);
    this.enforceCapacity();

    return {
      allowed: true,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - active.length),
      retryAfterSeconds: 0,
    };
  }

  reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }

  private enforceCapacity(): void {
    while (this.buckets.size > this.maxEntries) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) break;
      this.buckets.delete(oldestKey);
    }
  }
}

const globalForRateLimiter = globalThis as unknown as {
  __salonflowRateLimiter?: MemorySlidingWindowRateLimiter;
};

export const rateLimiter =
  globalForRateLimiter.__salonflowRateLimiter ?? new MemorySlidingWindowRateLimiter();

if (process.env.NODE_ENV !== "production") {
  globalForRateLimiter.__salonflowRateLimiter = rateLimiter;
}

export function buildRateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
  };

  if (!decision.allowed) {
    headers["Retry-After"] = String(decision.retryAfterSeconds);
  }

  return headers;
}
