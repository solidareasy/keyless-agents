import { describe, expect, it } from 'vitest';
import { RateLimiter } from './limiter.js';

describe('RateLimiter', () => {
  it('keeps sandbox buckets independent and refills through the injected clock', () => {
    let t = 0;
    const limiter = new RateLimiter({ perMinute: 60, burst: 10 }, () => t);
    for (let i = 0; i < 10; i++) expect(limiter.take('canary-a')).toEqual({ allowed: true });
    expect(limiter.take('canary-a')).toEqual({ allowed: false, retryAfterMs: 1000 });
    expect(limiter.take('canary-b')).toEqual({ allowed: true });
    t = 1000;
    expect(limiter.take('canary-a')).toEqual({ allowed: true });
    expect(limiter.take('canary-a')).toEqual({ allowed: false, retryAfterMs: 1000 });
  });

  it('forgets one sandbox so its next request receives a new full bucket', () => {
    const limiter = new RateLimiter({ perMinute: 60, burst: 1 }, () => 0);
    expect(limiter.take('canary-a')).toEqual({ allowed: true });
    expect(limiter.take('canary-b')).toEqual({ allowed: true });
    limiter.forget('canary-a');
    expect(limiter.take('canary-a')).toEqual({ allowed: true });
    expect(limiter.take('canary-a')).toEqual({ allowed: false, retryAfterMs: 1000 });
    expect(limiter.take('canary-b')).toEqual({ allowed: false, retryAfterMs: 1000 });
    limiter.forget('canary-unknown');
  });
});
