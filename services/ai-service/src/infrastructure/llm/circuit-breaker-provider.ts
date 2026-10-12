import { Logger } from '@nestjs/common';
import {
  ChatEvent,
  ChatProvider,
  ChatRequest,
} from '../../application/assistant/chat-provider';
import { LlmProvider, LlmRequest } from '../../application/llm-provider';
import { AiError } from '../../domain/errors';

// AI-9: only transport-level failures count; validation/auth/output errors never trip it.
const COUNTED = new Set(['AI_PROVIDER_UNAVAILABLE', 'AI_TIMEOUT']);

/**
 * Opens after `threshold` consecutive provider failures, fails fast for `openMs`, then lets one trial call through.
 * Shared by the JSON and the streaming chat provider wrappers below.
 */
export class CircuitBreaker {
  private readonly logger = new Logger('CircuitBreaker');
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private readonly threshold = 5,
    private readonly openMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws while open; returns true when this call is the half-open trial. */
  enter(): boolean {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt < this.openMs || this.trialInFlight)
      throw new AiError('AI_PROVIDER_UNAVAILABLE');
    this.trialInFlight = true;
    this.logger.warn('provider circuit half-open: trying one request');
    return true;
  }

  onSuccess(): void {
    if (this.openedAt !== null) this.logger.warn('provider circuit closed');
    this.failures = 0;
    this.openedAt = null;
  }

  onError(error: unknown, signal: AbortSignal, trial: boolean): void {
    // A caller hang-up says nothing about the provider: neither count nor reset.
    if (signal.aborted) return;
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
  }

  /** Always call when a call ends, however it ended, so an abandoned trial cannot wedge the circuit. */
  leave(trial: boolean): void {
    if (trial) this.trialInFlight = false;
  }
}

export class CircuitBreakerProvider implements LlmProvider {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly inner: LlmProvider,
    threshold = 5,
    openMs = 30_000,
    now: () => number = Date.now,
  ) {
    this.breaker = new CircuitBreaker(threshold, openMs, now);
  }

  async completeJson(
    request: LlmRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const trial = this.breaker.enter();
    try {
      const result = await this.inner.completeJson(request, signal);
      this.breaker.onSuccess();
      return result;
    } catch (error) {
      this.breaker.onError(error, signal, trial);
      throw error;
    } finally {
      this.breaker.leave(trial);
    }
  }
}

/** Same breaker for the streaming chat provider: a stream counts as one call, successful when it ends normally. */
export class CircuitBreakerChatProvider implements ChatProvider {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly inner: ChatProvider,
    threshold = 5,
    openMs = 30_000,
    now: () => number = Date.now,
  ) {
    this.breaker = new CircuitBreaker(threshold, openMs, now);
  }

  async *stream(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const trial = this.breaker.enter();
    try {
      yield* this.inner.stream(request, signal);
      this.breaker.onSuccess();
    } catch (error) {
      this.breaker.onError(error, signal, trial);
      throw error;
    } finally {
      this.breaker.leave(trial);
    }
  }
}
