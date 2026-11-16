// A token bucket per client address: 120 requests per minute.

export interface Bucket {
  tokens: number;
  at: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly perMinute = 120,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the request may go on. */
  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, at: t };
    b.tokens = Math.min(
      this.perMinute,
      b.tokens + ((t - b.at) * this.perMinute) / 60000,
    );
    b.at = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10000) this.prune(t);
    return ok;
  }

  private prune(t: number): void {
    for (const [k, b] of this.buckets)
      if (t - b.at > 120000) this.buckets.delete(k);
  }
}
