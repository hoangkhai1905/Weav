import { Logger } from '@nestjs/common';
import { LlmProvider, LlmRequest } from '../../application/llm-provider';
import { AiError } from '../../domain/errors';

// AI-9: only transport-level failures count; validation/auth/output errors never trip it.
const COUNTED = new Set(['AI_PROVIDER_UNAVAILABLE', 'AI_TIMEOUT']);

/** Opens after `threshold` consecutive provider failures, fails fast for `openMs`, then lets one trial call through. */
export class CircuitBreakerProvider implements LlmProvider {
  private readonly logger = new Logger('CircuitBreaker');
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private readonly inner: LlmProvider,
    private readonly threshold = 5,
    private readonly openMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async completeJson(
    request: LlmRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    let trial = false;
    if (this.openedAt !== null) {
      if (this.now() - this.openedAt < this.openMs || this.trialInFlight)
        throw new AiError('AI_PROVIDER_UNAVAILABLE');
      this.trialInFlight = trial = true;
      this.logger.warn('provider circuit half-open: trying one request');
    }
    try {
      const result = await this.inner.completeJson(request, signal);
      if (this.openedAt !== null) this.logger.warn('provider circuit closed');
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (error) {
      // A caller hang-up says nothing about the provider: neither count nor reset.
      if (signal.aborted) throw error;
      if (error instanceof AiError && COUNTED.has(error.code)) {
        if (trial || ++this.failures >= this.threshold) {
          if (this.openedAt === null || trial)
            this.logger.warn(`provider circuit open for ${this.openMs} ms`);
          this.openedAt = this.now();
        }
      } else {
        // a non-transport answer proves the provider is reachable
        this.failures = 0;
        this.openedAt = null;
      }
      throw error;
    } finally {
      if (trial) this.trialInFlight = false;
    }
  }
}
