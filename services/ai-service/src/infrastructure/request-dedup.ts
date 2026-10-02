/**
 * AI-1: collapses duplicate requests (same workspace + requestId) so an engine retry or crash
 * recovery of the same attempt is not billed twice. Concurrent duplicates share one promise;
 * successful results are kept for a short TTL. Failures are never cached.
 * ponytail: per-replica only; move to Valkey if ai-service scales out.
 */
export class RequestDedup<T> {
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly done = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maxEntries = 1000,
    private readonly now: () => number = Date.now,
  ) {}

  run(key: string, work: () => Promise<T>): Promise<T> {
    const cached = this.done.get(key);
    if (cached) {
      if (cached.expiresAt > this.now()) return Promise.resolve(cached.value);
      this.done.delete(key);
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const promise = work().then(
      (value) => {
        this.inFlight.delete(key);
        this.done.set(key, { value, expiresAt: this.now() + this.ttlMs });
        if (this.done.size > this.maxEntries) {
          this.done.delete(this.done.keys().next().value as string); // oldest insertion
        }
        return value;
      },
      (error: unknown) => {
        this.inFlight.delete(key);
        throw error;
      },
    );
    this.inFlight.set(key, promise);
    return promise;
  }
}
