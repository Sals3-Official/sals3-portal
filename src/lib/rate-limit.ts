/**
 * In-process token-bucket limiter.
 *
 * Spec section 8.10 requires shortlist and preflight to be rate-limited and
 * audited. State lives in a module-level `Map`, so the budget is per server
 * instance — an accepted limitation for a single-instance deployment, and a
 * deliberate choice over adding Redis or a paid rate-limit service for a
 * Seller Center used by a handful of employees. Move to a shared store when
 * the portal runs more than one instance.
 */

export type RateLimitConfig = {
  capacity: number;
  refillIntervalMs: number;
};

export type RateLimitOutcome = {
  allowed: boolean;
  retryAfterMs: number;
};

type Bucket = {
  tokens: number;
  lastRefillAt: number;
};

const buckets = new Map<string, Bucket>();

/** Bounds memory if keys are ever derived from something high-cardinality. */
const MAX_TRACKED_KEYS = 10_000;

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now(),
): RateLimitOutcome {
  const bucket = buckets.get(key) ?? {
    tokens: config.capacity,
    lastRefillAt: now,
  };

  const elapsedMs = now - bucket.lastRefillAt;
  const refillTokens = Math.floor(elapsedMs / config.refillIntervalMs);

  if (refillTokens > 0) {
    bucket.tokens = Math.min(config.capacity, bucket.tokens + refillTokens);
    bucket.lastRefillAt = now;
  }

  if (bucket.tokens <= 0) {
    buckets.set(key, bucket);
    const sinceLastTick = elapsedMs % config.refillIntervalMs;
    return {
      allowed: false,
      retryAfterMs: config.refillIntervalMs - sinceLastTick,
    };
  }

  bucket.tokens -= 1;

  if (!buckets.has(key) && buckets.size >= MAX_TRACKED_KEYS) {
    // Drop the oldest entry rather than growing without bound.
    const oldestKey = buckets.keys().next().value;
    if (oldestKey !== undefined) buckets.delete(oldestKey);
  }

  buckets.set(key, bucket);
  return { allowed: true, retryAfterMs: 0 };
}

/** Test-only reset, mirroring `resetCjToken()` in `src/services/cj/token.ts`. */
export function resetRateLimiter(): void {
  buckets.clear();
}
