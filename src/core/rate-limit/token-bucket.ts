export type RateLimitConfig = { perMinute: number; burst: number };

export function validateRateLimitConfig(
  cfg: RateLimitConfig,
): { ok: true } | { ok: false; code: 'BAD_CONFIG' } {
  if (
    !Number.isInteger(cfg.perMinute) ||
    cfg.perMinute <= 0 ||
    !Number.isInteger(cfg.burst) ||
    cfg.burst < 1
  ) {
    return { ok: false, code: 'BAD_CONFIG' };
  }
  return { ok: true };
}

/** Requires validated configuration and a monotonic clock in milliseconds. */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly tokensPerMs: number;

  constructor(
    cfg: RateLimitConfig,
    private readonly now: () => number,
  ) {
    this.capacity = cfg.burst;
    this.tokensPerMs = cfg.perMinute / 60_000;
    this.tokens = cfg.burst;
    this.lastRefill = now();
  }

  take(): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const current = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (current - this.lastRefill) * this.tokensPerMs,
    );
    this.lastRefill = current;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true };
    }
    return { allowed: false, retryAfterMs: Math.ceil((1 - this.tokens) / this.tokensPerMs) };
  }
}
