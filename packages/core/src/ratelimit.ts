/** Sliding-window rate limiter keyed by an arbitrary id (e.g. a chat user). */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): { allowed: true } | { allowed: false; retryInMs: number } {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { allowed: false, retryInMs: this.windowMs - (t - recent[0]) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    return { allowed: true };
  }
}
