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
  NotificationProvider,
  Provider,
} from '../domain/notification';
import { SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';

export const PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');
@Injectable()
export class DeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly repo: DeliveryRepository,
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(PROVIDERS)
    private readonly providers: Record<Provider, NotificationProvider>,
  ) {}
  onModuleInit() {
    this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.active = this.tick()
        .catch(() =>
          this.logger.error({ event: 'notification_worker_unavailable' }),
        )
        .finally(() => this.schedule());
    }, this.settings.NOTIFICATION_POLL_MS);
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
  async tick() {
    const d = await this.repo.claim(
      this.settings.NOTIFICATION_MAX_ATTEMPTS,
      this.settings.NOTIFICATION_LEASE_MS,
    );
    if (d) await this.deliver(d);
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
        await this.repo.finish(d, {
          status: 'SENT',
          sentAt: new Date(),
          scheduledAt: null,
          lastError: null,
        });
      } else {
        await this.repo.finish(d, {
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
