import { TokenBucket } from './token-bucket.js';
import type { RateLimitConfig } from './token-bucket.js';

/** Requires validated configuration and a monotonic clock in milliseconds. */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly cfg: RateLimitConfig;

  constructor(
    cfg: RateLimitConfig,
    private readonly now: () => number,
  ) {
    this.cfg = { ...cfg };
  }

  take(sandboxId: string): ReturnType<TokenBucket['take']> {
    let bucket = this.buckets.get(sandboxId);
    if (bucket === undefined) {
      bucket = new TokenBucket(this.cfg, this.now);
      this.buckets.set(sandboxId, bucket);
    }
    return bucket.take();
  }

  forget(sandboxId: string): void {
    this.buckets.delete(sandboxId);
  }
}
