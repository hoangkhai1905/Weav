import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../node_modules/.prisma/notification';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { databaseOptions, SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';
import { renderNotification } from '../domain/notification-catalog';
import type {
  NotificationCategory,
  NotificationSeverity,
} from '../domain/notification-catalog';
import type { NotificationEventV2 } from '../domain/notification-event';
import { notificationEventV2Schema } from '../domain/notification-event';
import { InboxRepository, inboxDedupKey, inboxIdForKey } from '../domain/inbox';
import type { InboxItem, InboxQuery, ReconcileResult } from '../domain/inbox';
import {
  assertDeliveryEventIdentity,
  assertInboxEventIdentity,
  InboxPersistenceConflictError,
  persistLegacyInboxGroup,
} from './inbox.persistence';

const uuidSchema = z.uuid();
const reconciliationLockNamespace = 1313821769;

type CandidateGroup = {
  sourceEventId: string | null;
  userId: string;
  legacyDeliveryId: string | null;
};

type InboxRecord = Prisma.NotificationInboxGetPayload<Record<string, never>>;
type DeliveryRecord = Prisma.NotificationDeliveryGetPayload<
  Record<string, never>
>;

function canonicalUuid(value: string): string {
  return uuidSchema.parse(value).toLowerCase();
}

function nullableUuid(value: string | null): string | null {
  return value === null ? null : canonicalUuid(value);
}

function normalizeEvent(input: NotificationEventV2): NotificationEventV2 {
  const validated = notificationEventV2Schema.parse(input);
  const data =
    'workflowId' in validated.data
      ? {
          ...validated.data,
          workflowId: canonicalUuid(validated.data.workflowId),
        }
      : 'subjectUserId' in validated.data
        ? {
            ...validated.data,
            subjectUserId: canonicalUuid(validated.data.subjectUserId),
          }
        : validated.data;
  return {
    ...validated,
    eventId: canonicalUuid(validated.eventId),
    actorUserId:
      validated.actorUserId === null
        ? null
        : canonicalUuid(validated.actorUserId),
    recipientUserIds: [
      ...new Set(validated.recipientUserIds.map(canonicalUuid)),
    ],
    workspaceId:
      validated.workspaceId === null
        ? null
        : canonicalUuid(validated.workspaceId),
    entity: {
      ...validated.entity,
      id: canonicalUuid(validated.entity.id),
    },
    data,
  } as NotificationEventV2;
}

function mapInbox(row: InboxRecord): InboxItem {
  return {
    id: row.id.toLowerCase(),
    dedupKey: row.dedupKey,
    sourceEventId: nullableUuid(row.sourceEventId),
    userId: row.userId.toLowerCase(),
    eventType: row.eventType,
    category: row.category as NotificationCategory,
    severity: row.severity as NotificationSeverity,
    workspaceId: nullableUuid(row.workspaceId),
    actorUserId: nullableUuid(row.actorUserId),
    executionId: nullableUuid(row.executionId),
    content: row.content as unknown as InboxItem['content'],
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

@Injectable()
export class PrismaInboxRepository
  extends InboxRepository
  implements OnModuleDestroy
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

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async ready(): Promise<boolean> {
    try {
      await this.client.notificationInbox.count({ take: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async ingest(input: NotificationEventV2): Promise<void> {
    const event = normalizeEvent(input);
    const occurredAt = new Date(event.occurredAt);

    await this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${event.eventId}, 0))
        `;
        const existingInbox = await tx.notificationInbox.findMany({
          where: { sourceEventId: event.eventId },
        });
        const expectedExecutionId =
          event.entity.kind === 'EXECUTION' ? event.entity.id : null;
        if (existingInbox.length > 0) {
          assertInboxEventIdentity(existingInbox, {
            eventType: event.eventType,
            executionId: expectedExecutionId,
          });
        }

        const storedDeliveries = await tx.notificationDelivery.findMany({
          where: { sourceEventId: event.eventId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        if (storedDeliveries.length > 0) {
          if (expectedExecutionId === null)
            throw new InboxPersistenceConflictError();
          assertDeliveryEventIdentity(storedDeliveries, {
            eventType: event.eventType,
            executionId: expectedExecutionId,
          });
          const groups = new Map<string, typeof storedDeliveries>();
          for (const row of storedDeliveries) {
            const userId = canonicalUuid(row.userId);
            const group = groups.get(userId) ?? [];
            group.push(row);
            groups.set(userId, group);
          }
          for (const rows of groups.values())
            await persistLegacyInboxGroup(tx, rows, 'throw');
          return;
        }

        // A replay may carry more recipients: skipDuplicates adds only the missing rows (NT-6).
        const localized = {
          vi: renderNotification(event, 'vi'),
          en: renderNotification(event, 'en'),
        };
        const content = localized as unknown as Prisma.InputJsonObject;

        await tx.notificationInbox.createMany({
          skipDuplicates: true,
          data: event.recipientUserIds.map((userId) => ({
            id: inboxIdForKey(inboxDedupKey(userId, event.eventId)),
            dedupKey: inboxDedupKey(userId, event.eventId),
            sourceEventId: event.eventId,
            userId,
            eventType: event.eventType,
            category: localized.vi.category,
            severity: localized.vi.severity,
            workspaceId: event.workspaceId,
            actorUserId: event.actorUserId,
            executionId:
              event.entity.kind === 'EXECUTION' ? event.entity.id : null,
            content,
            occurredAt,
          })),
        });
        // skipDuplicates must not hide a row that owns our id/key but belongs to another event.
        const stored = await tx.notificationInbox.count({
          where: {
            sourceEventId: event.eventId,
            userId: { in: event.recipientUserIds },
          },
        });
        if (stored !== event.recipientUserIds.length)
          throw new InboxPersistenceConflictError();
      },
      { maxWait: 10000, timeout: 30000 },
    );
  }

  async list(userId: string, query: InboxQuery): Promise<InboxItem[]> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
      throw new RangeError('Inbox limit must be an integer from 1 to 100');
    const canonicalUserId = canonicalUuid(userId);
    const cursor = query.cursor
      ? {
          id: canonicalUuid(query.cursor.id),
          createdAt: query.cursor.createdAt,
        }
      : undefined;
    if (
      cursor &&
      (!(cursor.createdAt instanceof Date) ||
        Number.isNaN(cursor.createdAt.getTime()))
    )
      throw new RangeError('Inbox cursor timestamp must be a valid Date');

    const rows = await this.client.notificationInbox.findMany({
      where: {
        userId: canonicalUserId,
        ...(query.unreadOnly ? { readAt: null } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return rows.map(mapInbox);
  }

  unreadCount(userId: string): Promise<number> {
    return this.client.notificationInbox.count({
      where: { userId: canonicalUuid(userId), readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<InboxItem | null> {
    const canonicalUserId = canonicalUuid(userId);
    const canonicalId = canonicalUuid(id);
    // Write through to the v1 delivery rows linked by inbox_id in the same transaction (NT-4).
    await this.client.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE notification.notification_inbox
        SET read_at = date_trunc('milliseconds', clock_timestamp())
        WHERE user_id = ${canonicalUserId}::uuid
          AND id = ${canonicalId}::uuid
          AND read_at IS NULL
      `;
      await tx.$executeRaw`
        UPDATE notification.notification_deliveries SET read_at = NOW()
        WHERE user_id = ${canonicalUserId}::uuid
          AND inbox_id = ${canonicalId}::uuid
          AND read_at IS NULL
      `;
    });
    const row = await this.client.notificationInbox.findFirst({
      where: { userId: canonicalUserId, id: canonicalId },
    });
    return row ? mapInbox(row) : null;
  }

  markAllRead(userId: string): Promise<number> {
    const canonicalUserId = canonicalUuid(userId);
    return this.client.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
        UPDATE notification.notification_inbox
        SET read_at = date_trunc('milliseconds', clock_timestamp())
        WHERE user_id = ${canonicalUserId}::uuid
          AND read_at IS NULL
      `;
      await tx.$executeRaw`
        UPDATE notification.notification_deliveries SET read_at = NOW()
        WHERE user_id = ${canonicalUserId}::uuid
          AND read_at IS NULL
      `;
      return count;
    });
  }

  async reconcileLegacy(batchSize: number): Promise<ReconcileResult> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
      throw new RangeError(
        'Legacy reconciliation batch size must be 1 to 1000',
      );

    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(${reconciliationLockNamespace}, 1)
        `;
        const groups = await tx.$queryRaw<CandidateGroup[]>`
          SELECT source_event_id AS "sourceEventId",
                 user_id AS "userId",
                 CASE WHEN source_event_id IS NULL THEN id ELSE NULL::uuid END
                   AS "legacyDeliveryId"
          FROM notification.notification_deliveries
          WHERE inbox_id IS NULL
          GROUP BY source_event_id, user_id,
                   CASE WHEN source_event_id IS NULL THEN id ELSE NULL::uuid END
          ORDER BY MIN(created_at) ASC,
                   source_event_id ASC NULLS FIRST,
                   user_id ASC,
                   CASE WHEN source_event_id IS NULL THEN id ELSE NULL::uuid END
                     ASC NULLS FIRST
          LIMIT ${batchSize}
        `;
        const result: ReconcileResult = {
          scannedGroups: groups.length,
          createdItems: 0,
          linkedDeliveries: 0,
          skippedGroups: 0,
        };

        for (const candidate of groups) {
          const sourceEventId = nullableUuid(candidate.sourceEventId);
          const userId = canonicalUuid(candidate.userId);
          if (sourceEventId !== null)
            await tx.$executeRaw`
              SELECT pg_advisory_xact_lock(
                hashtextextended(${sourceEventId}, 0)
              )
            `;

          const rows = await tx.notificationDelivery.findMany({
            where:
              sourceEventId === null
                ? {
                    id: canonicalUuid(candidate.legacyDeliveryId!),
                    userId,
                    sourceEventId: null,
                  }
                : { sourceEventId, userId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          if (rows.every((row) => row.inboxId !== null)) continue;
          const persisted = await persistLegacyInboxGroup(tx, rows, 'skip');
          if (persisted.skipped) result.skippedGroups++;
          else {
            result.createdItems += persisted.createdItems;
            result.linkedDeliveries += persisted.linkedDeliveries;
          }
        }
        return result;
      },
      { maxWait: 10000, timeout: 60000 },
    );
  }
}
