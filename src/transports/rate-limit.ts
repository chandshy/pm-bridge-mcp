/**
 * Tiny token-bucket rate limiter keyed by an identifier string (IP, client,
 * or bearer token). Used by the HTTP transport to cap request bursts on
 * the unauthenticated paths (`/oauth/*`, `/health`) and on the authed MCP
 * endpoint so a stolen token can't DoS Bridge.
 *
 * Token-bucket picks over leaky-bucket because it allows small bursts
 * (friendlier to legitimate session ramp-up) while still enforcing an
 * average rate.
 */

export interface TokenBucketOptions {
  /** Max tokens stored in the bucket (burst). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(opts: TokenBucketOptions, now: () => number = Date.now) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerSecond / 1000;
    this.now = now;
  }

  /**
   * Try to take a token. Returns true when allowed; false when the caller
   * should be rejected (HTTP 429).
   */
  take(key: string, tokens = 1): boolean {
    const nowMs = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: nowMs };
      this.buckets.set(key, b);
    }
    // Refill based on elapsed time, capped at capacity.
    const elapsed = nowMs - b.updated;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
    b.updated = nowMs;
    if (b.tokens < tokens) return false;
    b.tokens -= tokens;
    return true;
  }

  /**
   * Evict buckets that have been idle long enough to be fully refilled —
   * keeps the map from growing unbounded for transient callers.
   */
  sweep(maxIdleMs = 10 * 60_000): number {
    const cutoff = this.now() - maxIdleMs;
    let removed = 0;
    for (const [k, v] of this.buckets) {
      if (v.updated < cutoff) {
        this.buckets.delete(k);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.buckets.size;
  }
}
