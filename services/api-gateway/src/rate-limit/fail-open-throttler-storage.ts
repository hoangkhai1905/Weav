import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

type DestroyableStorage = ThrottlerStorage & Partial<OnModuleDestroy>;

/**
 * Wraps a shared throttler storage so a Valkey outage never blocks traffic.
 * ponytail: fails open (limits not enforced while Valkey is down), matching
 * identity's limiter; add a local in-memory fallback if that is too lax.
 */
export class FailOpenThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(FailOpenThrottlerStorage.name);

  constructor(private readonly inner: DestroyableStorage) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.inner.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    } catch (error) {
      this.logger.warn(
        // Class name only: client errors can carry connection details.
        `Throttler storage unavailable, allowing request: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
      return {
        totalHits: 1,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  onModuleDestroy(): void {
    this.inner.onModuleDestroy?.();
  }
}
