import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  NotificationCategory,
  NotificationContent,
  NotificationLocale,
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

export abstract class InboxRepository {
  abstract ready(): Promise<boolean>;
  abstract ingest(event: NotificationEventV2): Promise<void>;
  abstract list(userId: string, query: InboxQuery): Promise<InboxItem[]>;
  abstract unreadCount(userId: string): Promise<number>;
  abstract markRead(userId: string, id: string): Promise<InboxItem | null>;
  abstract markAllRead(userId: string): Promise<number>;
  abstract savePushDevice(
    userId: string,
    token: string,
    locale: NotificationLocale,
  ): Promise<void>;
  abstract removePushDevice(userId: string, token: string): Promise<void>;
}

/** Newest devices kept per user; older registrations are dropped on the next save. */
export const MAX_PUSH_DEVICES_PER_USER = 10;

/**
 * Pushes go only to devices registered within this window. The app re-registers every time it
 * opens while signed in, so a phone whose session lapsed (refresh token JWT_REFRESH_EXPIRES_IN=7d)
 * stops getting pushes even though it could not unregister.
 */
// ponytail: fixed 7 days, make it a setting if the refresh-token lifetime changes.
export const PUSH_DEVICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  // eslint-disable-next-line no-control-regex -- the ASCII range \x00-\x7F is intentional: keys must be 7-bit ASCII.
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
