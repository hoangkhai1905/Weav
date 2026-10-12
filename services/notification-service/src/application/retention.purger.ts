import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';

/**
 * Batched purge primitives. Each call deletes at most `limit` rows and returns how many it
 * deleted, or null when another instance holds the purge advisory lock (nothing was touched).
 */
export abstract class RetentionRepository {
  /** Terminal deliveries (SENT, or FAILED with no retry scheduled) older than the cutoff. */
  abstract purgeDeliveries(
    retentionDays: number,
    limit: number,
  ): Promise<number | null>;
  /** Inbox rows older than the cutoff that no delivery references any more. */
  abstract purgeInbox(
    retentionDays: number,
    limit: number,
  ): Promise<number | null>;
}

export const RETENTION_BATCH_SIZE = 1000;
// Safety bound per table per run (1000 x 500 = 500k rows); the next run continues the backlog.
export const RETENTION_MAX_BATCHES = 500;
export const RETENTION_INTERVAL_MS = 3_600_000;
export const RETENTION_FIRST_RUN_MS = 60_000;

export interface PurgeSummary {
  skipped: boolean;
  deliveries: number;
  inbox: number;
}

@Injectable()
export class RetentionPurger implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionPurger.name);
  private timer?: NodeJS.Timeout;
  private inflight?: Promise<PurgeSummary>;
  private stopped = false;
  constructor(
    private readonly repo: RetentionRepository,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}
  onModuleInit() {
    if (this.settings.NOTIFICATION_RETENTION_DAYS <= 0) {
      this.logger.log({ event: 'notification_retention_disabled' });
      return;
    }
    this.schedule(RETENTION_FIRST_RUN_MS);
  }
  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.schedule(RETENTION_INTERVAL_MS));
    }, delay);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inflight;
  }
  /** Single-flight: a run that overlaps an unfinished one is skipped. Never throws. */
  runOnce(): Promise<PurgeSummary> {
    if (this.inflight)
      return Promise.resolve({ skipped: true, deliveries: 0, inbox: 0 });
    const run = this.purge()
      .catch((error: unknown) => {
        this.logger.error({
          event: 'notification_retention_failed',
          errorClass: error instanceof Error ? error.name : typeof error,
        });
        return { skipped: false, deliveries: 0, inbox: 0 };
      })
      .finally(() => {
        this.inflight = undefined;
      });
    this.inflight = run;
    return run;
  }
  private async drain(
    purge: (days: number, limit: number) => Promise<number | null>,
  ) {
    const days = this.settings.NOTIFICATION_RETENTION_DAYS;
    let total = 0;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
      if (this.stopped) break;
      const deleted = await purge(days, RETENTION_BATCH_SIZE);
      if (deleted === null) return { total, locked: true };
      total += deleted;
      if (deleted < RETENTION_BATCH_SIZE) break;
    }
    return { total, locked: false };
  }
  private async purge(): Promise<PurgeSummary> {
    if (this.settings.NOTIFICATION_RETENTION_DAYS <= 0)
      return { skipped: true, deliveries: 0, inbox: 0 };
    // The composite FK is NO ACTION: deliveries must go before the inbox rows they reference.
    const deliveries = await this.drain((d, l) =>
      this.repo.purgeDeliveries(d, l),
    );
    if (deliveries.locked)
      return { skipped: true, deliveries: deliveries.total, inbox: 0 };
    const inbox = await this.drain((d, l) => this.repo.purgeInbox(d, l));
    const summary = {
      skipped: inbox.locked,
      deliveries: deliveries.total,
      inbox: inbox.total,
    };
    this.logger.log({
      event: 'notification_retention_completed',
      ...summary,
      retentionDays: this.settings.NOTIFICATION_RETENTION_DAYS,
    });
    return summary;
  }
}
