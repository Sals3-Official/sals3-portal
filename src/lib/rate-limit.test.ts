import { afterEach, describe, expect, it } from 'vitest';
import { checkRateLimit, resetRateLimiter } from './rate-limit';

const CONFIG = { capacity: 2, refillIntervalMs: 1000 };

describe('checkRateLimit', () => {
  afterEach(() => {
    resetRateLimiter();
  });

  it('allows requests up to capacity', () => {
    expect(checkRateLimit('a', CONFIG, 0).allowed).toBe(true);
    expect(checkRateLimit('a', CONFIG, 0).allowed).toBe(true);
  });

  it('rejects once capacity is spent, and reports a retry delay', () => {
    checkRateLimit('b', CONFIG, 0);
    checkRateLimit('b', CONFIG, 0);

    const outcome = checkRateLimit('b', CONFIG, 0);
    expect(outcome.allowed).toBe(false);
    expect(outcome.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills after the interval elapses', () => {
    checkRateLimit('c', CONFIG, 0);
    checkRateLimit('c', CONFIG, 0);
    expect(checkRateLimit('c', CONFIG, 0).allowed).toBe(false);
    expect(checkRateLimit('c', CONFIG, 1000).allowed).toBe(true);
  });

  it('keeps separate budgets per key, so one actor cannot spend another actor budget', () => {
    checkRateLimit('actor-1', CONFIG, 0);
    checkRateLimit('actor-1', CONFIG, 0);
    expect(checkRateLimit('actor-1', CONFIG, 0).allowed).toBe(false);
    expect(checkRateLimit('actor-2', CONFIG, 0).allowed).toBe(true);
  });
});
