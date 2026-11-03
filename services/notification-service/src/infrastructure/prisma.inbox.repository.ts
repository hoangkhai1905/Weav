import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../node_modules/.prisma/notification';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { databaseOptions, SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';
import { renderNotification } from '../domain/notification-catalog';
import type {
  NotificationCategory,
  NotificationLocale,
  NotificationSeverity,
} from '../domain/notification-catalog';
import type { NotificationEventV2 } from '../domain/notification-event';
import { notificationEventV2Schema } from '../domain/notification-event';
import {
  InboxRepository,
  inboxDedupKey,
  inboxIdForKey,
  MAX_PUSH_DEVICES_PER_USER,
} from '../domain/inbox';
import type { InboxItem, InboxQuery } from '../domain/inbox';
import {
  assertDeliveryEventIdentity,
  assertInboxEventIdentity,
  InboxPersistenceConflictError,
  persistLegacyInboxGroup,
} from './inbox.persistence';

const uuidSchema = z.uuid();
const invitationEventType = 'workspace.invitation.created';
const INBOX_PUSH_SOURCE = 'inbox';

type InboxRecord = Prisma.NotificationInboxGetPayload<Record<string, never>>;

function isInboxPush(row: {
  provider: string;
  payload: Prisma.JsonValue;
}): boolean {
  const payload = row.payload as { source?: unknown } | null;
  return row.provider === 'EXPO_PUSH' && payload?.source === INBOX_PUSH_SOURCE;
}

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

        // Inbox pushes are written by this path; a redelivery re-runs the idempotent inserts below.
        const storedDeliveries = (
          await tx.notificationDelivery.findMany({
            where: { sourceEventId: event.eventId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        ).filter((row) => !isInboxPush(row));
        if (storedDeliveries.length > 0) {
          // W7-A1: an invitation event owns its EMAIL delivery; a broker redelivery is a no-op.
          if (
            event.eventType === invitationEventType &&
            storedDeliveries.every(
              (row) => row.eventType === invitationEventType,
            )
          )
            return;
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

        // One push per registered device, in the language that device asked for.
        const devices = await tx.pushDevice.findMany({
          where: { userId: { in: event.recipientUserIds } },
        });
        if (devices.length > 0)
          await tx.notificationDelivery.createMany({
            skipDuplicates: true,
            data: devices.map((device) => {
              const text = localized[device.locale === 'en' ? 'en' : 'vi'];
              return {
                userId: device.userId,
                inboxId: inboxIdForKey(
                  inboxDedupKey(device.userId, event.eventId),
                ),
                sourceEventId: event.eventId,
                provider: 'EXPO_PUSH' as const,
                destination: device.token,
                eventType: event.eventType,
                executionId:
                  event.entity.kind === 'EXECUTION' ? event.entity.id : null,
                // readAt: the legacy v1 list must not count the push as an unread notification.
                readAt: new Date(),
                payload: {
                  source: INBOX_PUSH_SOURCE,
                  title: text.title,
                  message: text.message,
                },
              };
            }),
          });

        if (event.eventType === invitationEventType) {
          // Owned by the inviter (the only recipient), linked to the inviter's inbox row (D4).
          const inviterId = event.recipientUserIds[0];
          await tx.notificationDelivery.createMany({
            skipDuplicates: true,
            data: [
              {
                userId: inviterId,
                inboxId: inboxIdForKey(inboxDedupKey(inviterId, event.eventId)),
                sourceEventId: event.eventId,
                provider: 'EMAIL',
                destination: event.data.inviteeEmail,
                eventType: event.eventType,
                executionId: null,
                // readAt: the legacy v1 list must not count the e-mail as an unread notification.
                readAt: new Date(),
                payload: {
                  workspaceName: event.data.workspaceName,
                  inviterName: event.data.inviterName,
                  expiresAt: event.data.expiresAt,
                  title: 'Invitation e-mail',
                  message: 'An invitation e-mail was sent.',
                },
              },
            ],
          });
        }
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

  async savePushDevice(
    userId: string,
    token: string,
    locale: NotificationLocale,
  ): Promise<void> {
    const owner = canonicalUuid(userId);
    await this.client.$transaction(async (tx) => {
      await tx.pushDevice.upsert({
        where: { token },
        create: { token, userId: owner, locale },
        update: { userId: owner, locale },
      });
      await tx.$executeRaw`
        DELETE FROM notification.push_devices
        WHERE user_id = ${owner}::uuid
          AND token NOT IN (
            SELECT token FROM notification.push_devices
            WHERE user_id = ${owner}::uuid
            ORDER BY updated_at DESC
            LIMIT ${MAX_PUSH_DEVICES_PER_USER}
          )
      `;
    });
  }

  async removePushDevice(userId: string, token: string): Promise<void> {
    await this.client.pushDevice.deleteMany({
      where: { token, userId: canonicalUuid(userId) },
    });
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
}
