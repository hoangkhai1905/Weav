import { Prisma } from '../../node_modules/.prisma/notification';
import { z } from 'zod';
import {
  NotificationContent,
  NotificationSeverity,
  NotificationTarget,
  renderNotification,
} from '../domain/notification-catalog';
import { notificationEventV2Schema } from '../domain/notification-event';
import { inboxDedupKey, inboxIdForKey } from '../domain/inbox';

type Transaction = Prisma.TransactionClient;
type DeliveryRecord = Prisma.NotificationDeliveryGetPayload<
  Record<string, never>
>;
type InboxRecord = Prisma.NotificationInboxGetPayload<Record<string, never>>;

const uuidSchema = z.uuid();
const workflowNameSchema = z.string().min(1).max(200).regex(/\S/);

export class InboxPersistenceConflictError extends Error {
  constructor() {
    super('Conflicting persisted notification event');
    this.name = 'InboxPersistenceConflictError';
  }
}

export interface LegacyInboxPersistResult {
  createdItems: number;
  linkedDeliveries: number;
  skipped: boolean;
}

function canonicalUuid(value: string): string {
  return uuidSchema.parse(value).toLowerCase();
}

function nullableUuid(value: string | null): string | null {
  return value === null ? null : canonicalUuid(value);
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = uuidSchema.safeParse(value);
  return result.success ? result.data.toLowerCase() : null;
}

function legacyContent(
  representative: DeliveryRecord,
  userId: string,
  sourceEventId: string | null,
  occurredAt: Date,
): { vi: NotificationContent; en: NotificationContent } {
  const metadata = jsonObject(representative.payload);
  const workflowName = workflowNameSchema.safeParse(metadata?.workflowName);
  const workflowId = optionalUuid(metadata?.workflowId);
  const workspaceId = optionalUuid(metadata?.workspaceId);
  const executionId = nullableUuid(representative.executionId);

  if (
    workflowName.success &&
    workflowId !== null &&
    workspaceId !== null &&
    executionId !== null
  ) {
    const event = notificationEventV2Schema.parse({
      schemaVersion: 2,
      eventId: sourceEventId ?? representative.id,
      eventType: representative.eventType,
      occurredAt: occurredAt.toISOString(),
      producer: 'workflow-service',
      actorUserId: null,
      recipientUserIds: [userId],
      workspaceId,
      entity: { kind: 'EXECUTION', id: executionId },
      data: { workflowName: workflowName.data, workflowId },
    });
    return {
      vi: renderNotification(event, 'vi'),
      en: renderNotification(event, 'en'),
    };
  }

  const completed = representative.eventType === 'workflow.completed';
  const severity: NotificationSeverity = completed ? 'SUCCESS' : 'ERROR';
  const target: NotificationTarget =
    workspaceId !== null && executionId !== null
      ? { kind: 'EXECUTION', workspaceId, executionId }
      : { kind: 'NONE' };
  return {
    vi: {
      category: 'WORKFLOW',
      severity,
      title: completed ? 'Quy trình đã hoàn tất' : 'Quy trình chạy thất bại',
      message: completed
        ? 'Quy trình đã hoàn tất thành công.'
        : 'Quy trình thất bại. Mở chi tiết lần chạy để xem thêm.',
      target,
    },
    en: {
      category: 'WORKFLOW',
      severity,
      title: completed ? 'Workflow completed' : 'Workflow failed',
      message: completed
        ? 'Workflow completed successfully.'
        : 'Workflow failed. Open the execution for details.',
      target,
    },
  };
}

function compareDelivery(left: DeliveryRecord, right: DeliveryRecord): number {
  const timeDifference = left.createdAt.getTime() - right.createdAt.getTime();
  if (timeDifference !== 0) return timeDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function matchesPersistedIdentity(
  item: InboxRecord,
  expected: {
    id: string;
    dedupKey: string;
    sourceEventId: string | null;
    userId: string;
    eventType: string;
    executionId: string | null;
  },
): boolean {
  return (
    item.id.toLowerCase() === expected.id &&
    item.dedupKey === expected.dedupKey &&
    nullableUuid(item.sourceEventId) === expected.sourceEventId &&
    item.userId.toLowerCase() === expected.userId &&
    item.eventType === expected.eventType &&
    nullableUuid(item.executionId) === expected.executionId
  );
}

export async function persistLegacyInboxGroup(
  tx: Transaction,
  inputRows: DeliveryRecord[],
  conflictMode: 'throw' | 'skip',
): Promise<LegacyInboxPersistResult> {
  const conflict = (): LegacyInboxPersistResult => {
    if (conflictMode === 'throw') throw new InboxPersistenceConflictError();
    return { createdItems: 0, linkedDeliveries: 0, skipped: true };
  };
  if (inputRows.length === 0)
    return { createdItems: 0, linkedDeliveries: 0, skipped: false };

  const rows = [...inputRows].sort(compareDelivery);
  const representative = rows[0];
  const sourceEventId = nullableUuid(representative.sourceEventId);
  const userId = canonicalUuid(representative.userId);
  const eventType = representative.eventType;
  const executionId = nullableUuid(representative.executionId);
  if (
    (eventType !== 'workflow.completed' && eventType !== 'workflow.failed') ||
    rows.some(
      (row) =>
        nullableUuid(row.sourceEventId) !== sourceEventId ||
        canonicalUuid(row.userId) !== userId ||
        row.eventType !== eventType ||
        nullableUuid(row.executionId) !== executionId,
    )
  )
    return conflict();

  const dedupKey = inboxDedupKey(
    userId,
    sourceEventId,
    sourceEventId === null ? representative.id : undefined,
  );
  const inboxId = inboxIdForKey(dedupKey);
  const linkedIds = new Set(
    rows
      .map((row) => row.inboxId)
      .filter((id): id is string => id !== null)
      .map(canonicalUuid),
  );
  if ([...linkedIds].some((linkedId) => linkedId !== inboxId))
    return conflict();

  const [byId, byKey] = await Promise.all([
    tx.notificationInbox.findUnique({ where: { id: inboxId } }),
    tx.notificationInbox.findUnique({ where: { dedupKey } }),
  ]);
  const expected = {
    id: inboxId,
    dedupKey,
    sourceEventId,
    userId,
    eventType,
    executionId,
  };
  if (
    (byId && byKey && byId.id.toLowerCase() !== byKey.id.toLowerCase()) ||
    [byId, byKey].some(
      (item) => item !== null && !matchesPersistedIdentity(item, expected),
    )
  )
    return conflict();

  let inbox = byId ?? byKey;
  let createdItems = 0;
  if (!inbox) {
    const occurredAt = representative.createdAt;
    const content = legacyContent(
      representative,
      userId,
      sourceEventId,
      occurredAt,
    );
    const allRead = rows.every((row) => row.readAt !== null);
    const readAt = allRead
      ? rows.reduce<Date | null>(
          (latest, row) =>
            latest === null || row.readAt!.getTime() > latest.getTime()
              ? row.readAt
              : latest,
          null,
        )
      : null;
    inbox = await tx.notificationInbox.create({
      data: {
        id: inboxId,
        dedupKey,
        sourceEventId,
        userId,
        eventType,
        category: content.vi.category,
        severity: content.vi.severity,
        workspaceId: optionalUuid(
          jsonObject(representative.payload)?.workspaceId,
        ),
        actorUserId: null,
        executionId,
        content: content as unknown as Prisma.InputJsonObject,
        occurredAt,
        createdAt: occurredAt,
        readAt,
      },
    });
    createdItems = 1;
  }

  const pending = rows.filter((row) => row.inboxId === null);
  if (pending.length === 0)
    return { createdItems, linkedDeliveries: 0, skipped: false };

  const linkedDeliveries =
    sourceEventId === null
      ? await tx.$executeRaw`
          UPDATE notification.notification_deliveries
          SET inbox_id = ${inbox.id}::uuid
          WHERE id = ${representative.id}::uuid
            AND user_id = ${userId}::uuid
            AND inbox_id IS NULL
        `
      : await tx.$executeRaw`
          UPDATE notification.notification_deliveries
          SET inbox_id = ${inbox.id}::uuid
          WHERE source_event_id = ${sourceEventId}::uuid
            AND user_id = ${userId}::uuid
            AND inbox_id IS NULL
        `;
  if (linkedDeliveries !== pending.length)
    throw new Error('Legacy inbox links changed during persistence');

  return { createdItems, linkedDeliveries, skipped: false };
}

export function assertInboxEventIdentity(
  rows: InboxRecord[],
  event: { eventType: string; executionId: string | null },
): void {
  const executionId =
    event.executionId === null ? null : canonicalUuid(event.executionId);
  if (
    rows.some(
      (row) =>
        row.eventType !== event.eventType ||
        nullableUuid(row.executionId) !== executionId,
    )
  )
    throw new InboxPersistenceConflictError();
}

export function assertDeliveryEventIdentity(
  rows: DeliveryRecord[],
  event: { eventType: string; executionId: string },
): void {
  const executionId = canonicalUuid(event.executionId);
  if (
    rows.some(
      (row) =>
        row.eventType !== event.eventType ||
        nullableUuid(row.executionId) !== executionId,
    )
  )
    throw new InboxPersistenceConflictError();
}
