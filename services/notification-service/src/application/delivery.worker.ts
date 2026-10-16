import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  DeliveryError,
  DeliveryRepository,
  retryDelay,
} from '../domain/notification';
import type {
  Delivery,
  DeliveryPatch,
  NotificationProvider,
  Provider,
} from '../domain/notification';
import { SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';

export const PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');
// Upper bound on rows handled in one drain so a backlog cannot starve shutdown or the event loop.
export const MAX_DRAIN_PER_TICK = 50;
export const MAX_JITTER_MS = 2000;
const RAMP_CEILING_MS = 60000;
const errorClass = (error: unknown) =>
  error instanceof Error ? error.name : typeof error;
@Injectable()
export class DeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;
  private running = false;
  // wake() arrived while a tick was running: that tick may have read before the new row committed.
  private woken = false;
  // Current wait before the next poll: base interval while busy, doubled up to the cap while idle.
  private delay: number;
  // Constant per-process offset (<= MAX_JITTER_MS) so replicas do not hit the DB in the same ms; tests override.
  jitterMs = Math.floor(Math.random() * MAX_JITTER_MS);
  constructor(
    private readonly repo: DeliveryRepository,
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(PROVIDERS)
    private readonly providers: Record<Provider, NotificationProvider>,
  ) {
    this.delay = settings.NOTIFICATION_POLL_MS;
  }
  onModuleInit() {
    this.schedule();
  }
  private get maxDelay() {
    return Math.max(
      this.settings.NOTIFICATION_POLL_MS,
      this.settings.NOTIFICATION_WORKER_IDLE_MAX_MS,
    );
  }
  /** Current wait before the next poll (exposed for tests and diagnostics). */
  get currentDelayMs() {
    return this.delay;
  }
  private schedule() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = true;
      this.active = this.tick()
        .then((processed) => this.adjustDelay(processed))
        .catch((error: unknown) => {
          this.delay = this.idleDelay();
          this.logger.error({
            event: 'notification_worker_unavailable',
            errorClass: errorClass(error),
          });
        })
        .finally(() => {
          this.running = false;
          if (this.woken) this.delay = this.settings.NOTIFICATION_POLL_MS;
          this.woken = false;
          this.schedule();
        });
    }, this.delay);
  }
  /**
   * Idle wait: double from the base interval until the next doubling would reach min(cap, 60 s), then
   * sleep to the first multiple of the cap (epoch ms) that is at least cap/2 away, so every
   * service sharing the database wakes in the same cluster instead of drifting apart.
   */
  private idleDelay(now = Date.now()) {
    const max = this.maxDelay;
    // The ramp stops below 60 s so the first long gap (the aligned wake) starts early and Neon can reach its 5 min suspend timer.
    if (this.delay * 2 < Math.min(max, RAMP_CEILING_MS)) return this.delay * 2;
    return Math.max(
      this.settings.NOTIFICATION_POLL_MS,
      Math.ceil((now + max / 2) / max) * max + this.jitterMs - now,
    );
  }
  /** Reset to the base interval when work was found, otherwise sleep until the next retry is due or the aligned idle wake. */
  private async adjustDelay(processed: number) {
    const base = this.settings.NOTIFICATION_POLL_MS;
    if (processed > 0) {
      this.delay = base;
      return;
    }
    this.delay = this.idleDelay();
    let due: number | null | undefined;
    try {
      due = await this.repo.nextDueInMs(
        this.settings.NOTIFICATION_MAX_ATTEMPTS,
        this.settings.NOTIFICATION_LEASE_MS,
      );
    } catch {
      // Keep the idle wait: the claim above already proved the database reachable.
    }
    if (typeof due === 'number')
      this.delay = Math.max(base, Math.min(this.delay, Math.ceil(due)));
  }
  /** New work was just stored: poll at the base interval again instead of waiting out an idle backoff. */
  wake() {
    if (this.stopped) return;
    this.delay = this.settings.NOTIFICATION_POLL_MS;
    if (this.running) this.woken = true;
    else if (this.timer) this.schedule();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
  /** Drains due rows (bounded, stops on shutdown) and returns how many were handled. */
  async tick() {
    let processed = 0;
    while (processed < MAX_DRAIN_PER_TICK && !this.stopped) {
      const d = await this.repo.claim(
        this.settings.NOTIFICATION_MAX_ATTEMPTS,
        this.settings.NOTIFICATION_LEASE_MS,
      );
      if (!d) break;
      processed++;
      try {
        await this.deliver(d);
      } catch (error) {
        this.logger.error({
          event: 'notification_delivery_unexpected_error',
          deliveryId: d.id,
          errorClass: errorClass(error),
        });
        throw error;
      }
    }
    return processed;
  }
  // The provider already accepted the message: retry only this DB write, never the send.
  // Delivery to Telegram/Expo stays at-least-once by design; if all writes fail the lease
  // expires and the row is re-sent. No dedup store (see work log, NT-3).
  private async persistAccepted(d: Delivery, patch: DeliveryPatch) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.repo.finish(d, patch);
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
  }
  async deliver(d: Delivery) {
    const provider = this.providers[d.provider];
    const receipt =
      typeof d.payload._receiptId === 'string'
        ? d.payload._receiptId
        : undefined;
    try {
      if (
        receipt &&
        Date.now() - Number(d.payload._receiptSince) >= 23 * 3600000
      )
        throw new DeliveryError('EXPO_RECEIPT_EXPIRED', false);
      const result =
        receipt && provider.receipt
          ? await provider.receipt(receipt)
          : await provider.send(d);
      if (result.kind === 'sent') {
        await this.persistAccepted(d, {
          status: 'SENT',
          sentAt: new Date(),
          scheduledAt: null,
          lastError: null,
        });
      } else {
        await this.persistAccepted(d, {
          status: 'PENDING',
          scheduledAt: new Date(Date.now() + 15 * 60000),
          lastError: null,
          ...(result.kind === 'receipt'
            ? {
                payload: {
                  ...d.payload,
                  _receiptId: result.id,
                  _receiptSince: Date.now(),
                },
              }
            : {}),
        });
      }
    } catch (error) {
      // Do not classify database persistence failures as provider failures or overwrite a possible receipt.
      if (!(error instanceof DeliveryError)) throw error;
      const retryable =
        error.retryable &&
        ((Boolean(receipt) && !error.resend) ||
          d.retryCount < this.settings.NOTIFICATION_MAX_ATTEMPTS);
      const payload = { ...d.payload };
      if (receipt && error.resend) {
        delete payload._receiptId;
        delete payload._receiptSince;
      }
      const delay = retryDelay(
        d.retryCount,
        this.settings.NOTIFICATION_RETRY_BASE_MS,
        this.settings.NOTIFICATION_RETRY_MAX_MS,
        error.retryAfterMs,
      );
      await this.repo.finish(d, {
        status: 'FAILED',
        scheduledAt: retryable ? new Date(Date.now() + delay) : null,
        payload,
        lastError: { code: error.code, retryable },
      });
      this.logger.warn({
        event: 'notification_delivery_failed',
        deliveryId: d.id,
        code: error.code,
        retryable,
      });
    }
  }
}
