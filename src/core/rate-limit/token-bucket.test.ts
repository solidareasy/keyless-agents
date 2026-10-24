import { describe, expect, it } from 'vitest';
import { TokenBucket, validateRateLimitConfig } from './token-bucket.js';

describe('rate limit configuration', () => {
  it.each([
    { perMinute: 0, burst: 10 },
    { perMinute: 60, burst: 0 },
    { perMinute: 1.5, burst: 10 },
    { perMinute: 60, burst: 1.5 },
    { perMinute: -1, burst: 10 },
    { perMinute: 60, burst: -1 },
    { perMinute: NaN, burst: 10 },
    { perMinute: 60, burst: Infinity },
  ])('returns BAD_CONFIG for invalid numeric limits %#', (cfg) => {
    expect(validateRateLimitConfig(cfg)).toEqual({ ok: false, code: 'BAD_CONFIG' });
  });

  it('accepts positive integers', () => {
    expect(validateRateLimitConfig({ perMinute: 60, burst: 10 })).toEqual({ ok: true });
  });

  it('accepts burst greater than the per-minute refill', () => {
    expect(validateRateLimitConfig({ perMinute: 1, burst: 10 })).toEqual({ ok: true });
  });
});

describe('TokenBucket', () => {
  it('starts with burst 10, refills 60 per minute and caps idle refill at burst', () => {
    let t = 0;
    const bucket = new TokenBucket({ perMinute: 60, burst: 10 }, () => t);
    for (let i = 0; i < 10; i++) expect(bucket.take()).toEqual({ allowed: true });
    expect(bucket.take()).toEqual({ allowed: false, retryAfterMs: 1000 });
    t = 1000;
    expect(bucket.take()).toEqual({ allowed: true });
    expect(bucket.take()).toEqual({ allowed: false, retryAfterMs: 1000 });
    t += 60_000;
    for (let i = 0; i < 10; i++) expect(bucket.take()).toEqual({ allowed: true });
    expect(bucket.take()).toEqual({ allowed: false, retryAfterMs: 1000 });
  });

  it('preserves partial refill and rounds waits up to whole milliseconds', () => {
    let t = 0;
    const bucket = new TokenBucket({ perMinute: 7, burst: 1 }, () => t);
    expect(bucket.take()).toEqual({ allowed: true });
    expect(bucket.take()).toEqual({ allowed: false, retryAfterMs: 8572 });
    t = 4000;
    expect(bucket.take()).toEqual({ allowed: false, retryAfterMs: 4572 });
    t = 8571;
    expect(bucket.take()).toEqual({ allowed: false, retryAfterMs: 1 });
    t = 8572;
    expect(bucket.take()).toEqual({ allowed: true });
  });
});
