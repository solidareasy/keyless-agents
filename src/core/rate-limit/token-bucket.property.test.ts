import fc from 'fast-check';
import { expect, it } from 'vitest';
import { TokenBucket } from './token-bucket.js';
import { RateLimiter } from './limiter.js';

const config = fc.record({
  perMinute: fc.integer({ min: 1, max: 120 }),
  burst: fc.integer({ min: 1, max: 20 }),
});

it('bounds every rolling 60-second window and keeps denied retries positive', () => {
  fc.assert(
    fc.property(
      config,
      fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: 100, maxLength: 300 }),
      (cfg, deltas) => {
        let t = 0;
        const bucket = new TokenBucket(cfg, () => t);
        const accepted: number[] = [];
        for (const delta of deltas) {
          t += delta;
          const result = bucket.take();
          if (result.allowed) accepted.push(t);
          else {
            expect(result.retryAfterMs).toBeGreaterThan(0);
            expect(Number.isInteger(result.retryAfterMs)).toBe(true);
          }
          expect(accepted.filter((instant) => instant >= t - 60_000).length).toBeLessThanOrEqual(
            cfg.burst + cfg.perMinute,
          );
          expect(accepted.length).toBeLessThanOrEqual(
            cfg.burst + Math.floor((t * cfg.perMinute) / 60_000),
          );
        }
      },
    ),
    { numRuns: 500 },
  );
});

it('never exceeds burst without elapsed time and isolates arbitrary sandbox buckets', () => {
  fc.assert(
    fc.property(config, (cfg) => {
      const limiter = new RateLimiter(cfg, () => 0);
      for (let i = 0; i < cfg.burst; i++) {
        expect(limiter.take('canary-a')).toEqual({ allowed: true });
      }
      expect(limiter.take('canary-a').allowed).toBe(false);
      for (let i = 0; i < cfg.burst; i++) {
        expect(limiter.take('canary-b')).toEqual({ allowed: true });
      }
      expect(limiter.take('canary-b').allowed).toBe(false);
    }),
    { numRuns: 500 },
  );
});
