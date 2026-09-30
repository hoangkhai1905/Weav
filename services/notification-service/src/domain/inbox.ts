import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  NotificationCategory,
  NotificationContent,
  NotificationSeverity,
} from './notification-catalog';
import type { NotificationEventV2 } from './notification-event';

export interface InboxItem {
  id: string;
  dedupKey: string;
  sourceEventId: string | null;
  userId: string;
  eventType: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  workspaceId: string | null;
  actorUserId: string | null;
  executionId: string | null;
  content: { vi: NotificationContent; en: NotificationContent };
  occurredAt: Date;
  createdAt: Date;
  readAt: Date | null;
}

export interface InboxQuery {
  limit: number;
  cursor?: { id: string; createdAt: Date };
  unreadOnly?: boolean;
  category?: NotificationCategory;
}

export interface ReconcileResult {
  scannedGroups: number;
  createdItems: number;
  linkedDeliveries: number;
  skippedGroups: number;
}

export abstract class InboxRepository {
  abstract ready(): Promise<boolean>;
  abstract ingest(event: NotificationEventV2): Promise<void>;
  abstract list(userId: string, query: InboxQuery): Promise<InboxItem[]>;
  abstract unreadCount(userId: string): Promise<number>;
  abstract markRead(userId: string, id: string): Promise<InboxItem | null>;
  abstract markAllRead(userId: string): Promise<number>;
  abstract reconcileLegacy(batchSize: number): Promise<ReconcileResult>;
}

const uuidSchema = z.uuid();
const namespace = Buffer.from('d9d2029effbf4ff394a4927bb68c44c0', 'hex');

function canonicalUuid(value: string): string {
  return uuidSchema.parse(value).toLowerCase();
}

export function inboxDedupKey(
  userId: string,
  sourceEventId: string | null,
  legacyDeliveryId?: string,
): string {
  const user = canonicalUuid(userId);
  if (sourceEventId !== null)
    return `event:${canonicalUuid(sourceEventId)}:user:${user}`;
  if (legacyDeliveryId === undefined)
    throw new Error('A legacy delivery ID is required without a source event');
  return `legacy:${canonicalUuid(legacyDeliveryId)}:user:${user}`;
}

export function inboxIdForKey(dedupKey: string): string {
  if (dedupKey.length > 128 || !/^[\x00-\x7F]+$/.test(dedupKey)) {
    throw new Error('Inbox deduplication key must be at most 128 ASCII bytes');
  }
  const digest = createHash('sha1')
    .update(namespace)
    .update(dedupKey, 'utf8')
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
