import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../node_modules/.prisma/notification';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { databaseOptions, SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';
import {
  DeliveryRepository,
  executionEventSchema,
} from '../domain/notification';
import type {
  Delivery,
  DeliveryPatch,
  ExecutionEvent,
  ListQuery,
  Payload,
} from '../domain/notification';
import { RetentionRepository } from '../application/retention.purger';
import {
  assertDeliveryEventIdentity,
  assertInboxEventIdentity,
  InboxPersistenceConflictError,
  persistLegacyInboxGroup,
} from './inbox.persistence';

const uuidSchema = z.uuid();
// Pool max is 3 per client: under a consumer burst an ingest waits for a connection (Prisma
// default maxWait 2s -> P2028 -> requeue). Same bounds as the inbox repository.
const INGEST_TX_OPTIONS = { maxWait: 10000, timeout: 30000 };

function normalizeLegacyEvent(event: ExecutionEvent): ExecutionEvent {
  const validated = executionEventSchema.parse(event);
  return {
    ...validated,
    eventId: uuidSchema.parse(validated.eventId).toLowerCase(),
    aggregateId: uuidSchema.parse(validated.aggregateId).toLowerCase(),
    payload: {
      ...validated.payload,
      executionId: uuidSchema
        .parse(validated.payload.executionId)
        .toLowerCase(),
      workflowId: uuidSchema.parse(validated.payload.workflowId).toLowerCase(),
      workspaceId: uuidSchema
        .parse(validated.payload.workspaceId)
        .toLowerCase(),
      userId: uuidSchema.parse(validated.payload.userId).toLowerCase(),
    },
  };
}

@Injectable()
export class PrismaDeliveryRepository
  extends DeliveryRepository
  implements OnModuleDestroy, RetentionRepository
{
  readonly client: PrismaClient;
  constructor(@Inject(SETTINGS) settings: Settings) {
    super();
    this.client = new PrismaClient({
      adapter: new PrismaPg(databaseOptions(settings), {
        schema: 'notification',
      }),
    });
  }
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
  async ready() {
    try {
      await this.client.notificationDelivery.count({ take: 1 });
      return true;
    } catch {
      return false;
    }
  }
  async ingest(event: ExecutionEvent, payload: Payload) {
    const normalized = normalizeLegacyEvent(event);
    const safePayload: Payload = {
      ...payload,
      workflowId: normalized.payload.workflowId,
      workspaceId: normalized.payload.workspaceId,
    };
    await this.client.$transaction(async (tx) => {
      // Serialize complete-event ingestion; a replay cannot add new destinations to an existing event.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${normalized.eventId}, 0))`;
      const existingInbox = await tx.notificationInbox.findMany({
        where: { sourceEventId: normalized.eventId },
      });
      if (existingInbox.length > 0) {
        assertInboxEventIdentity(existingInbox, {
          eventType: normalized.eventType,
          executionId: normalized.payload.executionId,
        });
      }

      const existingDeliveries = await tx.notificationDelivery.findMany({
        where: { sourceEventId: normalized.eventId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (existingDeliveries.length > 0) {
        assertDeliveryEventIdentity(existingDeliveries, {
          eventType: normalized.eventType,
          executionId: normalized.payload.executionId,
        });
        const groups = new Map<string, typeof existingDeliveries>();
        for (const row of existingDeliveries) {
          const userId = row.userId.toLowerCase();
          const group = groups.get(userId) ?? [];
          group.push(row);
          groups.set(userId, group);
        }
        for (const rows of groups.values())
          await persistLegacyInboxGroup(tx, rows, 'throw');
        return;
      }

      if (existingInbox.length > 0) return;

      await tx.notificationDelivery.createMany({
        skipDuplicates: true,
        data: normalized.payload.recipients.map((r) => ({
          sourceEventId: normalized.eventId,
          userId: normalized.payload.userId,
          executionId: normalized.payload.executionId,
          provider: r.provider,
          destination: r.destination,
          eventType: normalized.eventType,
          payload: safePayload as Prisma.InputJsonObject,
        })),
      });
      const storedRows = await tx.notificationDelivery.findMany({
        where: { sourceEventId: normalized.eventId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (storedRows.length === 0) throw new InboxPersistenceConflictError();
      assertDeliveryEventIdentity(storedRows, {
        eventType: normalized.eventType,
        executionId: normalized.payload.executionId,
      });
      await persistLegacyInboxGroup(tx, storedRows, 'throw');
    }, INGEST_TX_OPTIONS);
  }
  async list(userId: string, q: ListQuery): Promise<Delivery[]> {
    const rows = await this.client.notificationDelivery.findMany({
      where: {
        userId,
        ...(q.unreadOnly ? { readAt: null } : {}),
        eventType: q.eventType,
        status: q.status,
        ...(q.cursor
          ? {
              OR: [
                { createdAt: { lt: q.cursor.createdAt } },
                { createdAt: q.cursor.createdAt, id: { lt: q.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return rows as Delivery[];
  }
  unreadCount(userId: string) {
    return this.client.notificationDelivery.count({
      where: { userId, readAt: null },
    });
  }
  async markRead(userId: string, id: string): Promise<Delivery | null> {
    // Read state must not change the worker's updated_at fencing value.
    // Write through to the v2 inbox row in the same transaction (NT-4).
    await this.client.$transaction(async (tx) => {
      // Mark every sibling delivery of the same inbox item too, so both APIs agree.
      await tx.$executeRaw`UPDATE notification.notification_deliveries SET read_at=NOW()
        WHERE user_id=${userId}::uuid AND read_at IS NULL
          AND (id=${id}::uuid OR inbox_id IN (SELECT inbox_id FROM notification.notification_deliveries
            WHERE id=${id}::uuid AND user_id=${userId}::uuid))`;
      await tx.$executeRaw`UPDATE notification.notification_inbox SET read_at=date_trunc('milliseconds', clock_timestamp())
        WHERE user_id=${userId}::uuid AND read_at IS NULL
          AND id IN (SELECT inbox_id FROM notification.notification_deliveries
            WHERE id=${id}::uuid AND user_id=${userId}::uuid)`;
    });
    return (await this.client.notificationDelivery.findFirst({
      where: { userId, id },
    })) as Delivery | null;
  }
  async markAllRead(userId: string) {
    return this.client.$transaction(async (tx) => {
      const count =
        await tx.$executeRaw`UPDATE notification.notification_deliveries SET read_at=NOW()
        WHERE user_id=${userId}::uuid AND read_at IS NULL`;
      await tx.$executeRaw`UPDATE notification.notification_inbox SET read_at=date_trunc('milliseconds', clock_timestamp())
        WHERE user_id=${userId}::uuid AND read_at IS NULL`;
      return count;
    });
  }
  async claim(maxAttempts: number, leaseMs: number): Promise<Delivery | null> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE notification.notification_deliveries SET status='FAILED', scheduled_at=NULL,
          last_error='{"code":"ATTEMPTS_EXHAUSTED","retryable":false}'::jsonb, updated_at=date_trunc('milliseconds', clock_timestamp())
        WHERE status='SENDING' AND updated_at < NOW() - (${leaseMs} * INTERVAL '1 millisecond')
          AND retry_count >= ${maxAttempts} AND NOT (payload ? '_receiptId')`;
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE notification.notification_deliveries SET status='SENDING',
          retry_count=retry_count + CASE WHEN payload ? '_receiptId' THEN 0 ELSE 1 END,
          updated_at=date_trunc('milliseconds', clock_timestamp())
        WHERE id IN (SELECT id FROM notification.notification_deliveries
          WHERE ((status='PENDING' AND (scheduled_at IS NULL OR scheduled_at<=NOW()))
            OR (status='FAILED' AND scheduled_at<=NOW())
            OR (status='SENDING' AND updated_at<NOW()-(${leaseMs} * INTERVAL '1 millisecond')))
            AND (retry_count<${maxAttempts} OR payload ? '_receiptId')
          ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`;
      return claimed.length
        ? ((await tx.notificationDelivery.findUnique({
            where: { id: claimed[0].id },
          })) as Delivery)
        : null;
    });
  }
  /**
   * Cheap MIN over the claim predicates (indexed on status, scheduled_at): earliest scheduled
   * retry/receipt check, or the earliest SENDING lease expiry. Computed on the DB clock; a past
   * value is returned as <= 0. null = nothing pending.
   */
  async nextDueInMs(maxAttempts: number, leaseMs: number) {
    const [row] = await this.client.$queryRaw<{ ms: number | null }[]>`
      SELECT (EXTRACT(EPOCH FROM LEAST(
        (SELECT MIN(scheduled_at) FROM notification.notification_deliveries
          WHERE status IN ('PENDING','FAILED') AND scheduled_at IS NOT NULL
            AND (retry_count<${maxAttempts} OR payload ? '_receiptId')),
        (SELECT MIN(updated_at) + (${leaseMs} * INTERVAL '1 millisecond')
          FROM notification.notification_deliveries WHERE status='SENDING')
      ) - NOW()) * 1000)::float8 AS ms`;
    return row?.ms ?? null;
  }
  async finish(delivery: Delivery, patch: DeliveryPatch) {
    await this.client.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        status: 'SENDING',
        updatedAt: delivery.updatedAt,
      },
      data: {
        ...patch,
        payload: patch.payload as Prisma.InputJsonObject | undefined,
        lastError:
          patch.lastError === null
            ? Prisma.DbNull
            : (patch.lastError as Prisma.InputJsonObject | undefined),
      },
    });
  }
  /** One short transaction per batch; the xact advisory lock is released on commit. null = lock busy. */
  private purgeBatch(
    run: (tx: Prisma.TransactionClient) => Promise<number>,
  ): Promise<number | null> {
    return this.client.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended('notification.retention.purge', 0)) AS locked`;
        return row?.locked ? run(tx) : null;
      },
      { timeout: 9000 },
    );
  }
  purgeDeliveries(retentionDays: number, limit: number) {
    return this.purgeBatch(
      (tx) => tx.$executeRaw`
        DELETE FROM notification.notification_deliveries
        WHERE id IN (SELECT id FROM notification.notification_deliveries
          WHERE (status='SENT' OR (status='FAILED' AND scheduled_at IS NULL))
            AND created_at < NOW() - (${retentionDays} * INTERVAL '1 day')
          LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
    );
  }
  purgeInbox(retentionDays: number, limit: number) {
    return this.purgeBatch(
      (tx) => tx.$executeRaw`
        DELETE FROM notification.notification_inbox
        WHERE id IN (SELECT i.id FROM notification.notification_inbox i
          WHERE i.created_at < NOW() - (${retentionDays} * INTERVAL '1 day')
            AND NOT EXISTS (SELECT 1 FROM notification.notification_deliveries d
              WHERE d.inbox_id = i.id AND d.user_id = i.user_id)
          LIMIT ${limit} FOR UPDATE OF i SKIP LOCKED)`,
    );
  }
}
