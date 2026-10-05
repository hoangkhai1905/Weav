/** Per-key fixed-window counter, local to the replica (like Admission). */
export class FixedWindowLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  tryHit(key: string): boolean {
    const now = this.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows)
        if (now - w.start >= this.windowMs) this.windows.delete(k);
    }
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    return ++current.count <= this.limit;
  }
}
