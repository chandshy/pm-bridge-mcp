import { describe, it, expect } from "vitest";
import { TokenBucketLimiter } from "./rate-limit.js";

function fakeClock(start = 1_000_000): () => number {
  let t = start;
  const clock = () => t;
  (clock as unknown as { advance: (ms: number) => void }).advance = (ms: number) => { t += ms; };
  return clock;
}

describe("TokenBucketLimiter", () => {
  it("allows up to capacity tokens in a burst", () => {
    const now = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 1 }, now);
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(false);
  });

  it("refills at the configured rate", () => {
    const now = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 2 }, now);
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(false);
    // 1 second → 2 tokens back
    (now as unknown as { advance: (ms: number) => void }).advance(1_000);
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(false);
  });

  it("keys are isolated from each other", () => {
    const now = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0.1 }, now);
    expect(lim.take("a")).toBe(true);
    expect(lim.take("a")).toBe(false);
    expect(lim.take("b")).toBe(true);   // separate bucket
  });

  it("caps refill at capacity (no unbounded accumulation)", () => {
    const now = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 1 }, now);
    (now as unknown as { advance: (ms: number) => void }).advance(10_000); // 10 seconds of refill
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(true);
    expect(lim.take("k")).toBe(false); // capped at 2, not 10
  });

  it("take(n) respects multi-token requests", () => {
    const now = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 5, refillPerSecond: 0 }, now);
    expect(lim.take("k", 3)).toBe(true);
    expect(lim.take("k", 3)).toBe(false);
    expect(lim.take("k", 2)).toBe(true);
  });

  it("sweep evicts idle buckets", () => {
    const now = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1 }, now);
    lim.take("a");
    lim.take("b");
    expect(lim.size()).toBe(2);
    (now as unknown as { advance: (ms: number) => void }).advance(11 * 60 * 1000);
    expect(lim.sweep(10 * 60 * 1000)).toBe(2);
    expect(lim.size()).toBe(0);
  });
});
