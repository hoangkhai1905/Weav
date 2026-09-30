import type { AxiosRequestConfig } from 'axios';
import type {
  NotificationCategoryFilter,
  NotificationLocale,
  NotificationQuery,
} from '../../domain/notification/notification.types';

export const NOTIFICATIONS_V2_PATH = '/api/v2/notifications';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set<NotificationCategoryFilter>([
  'WORKFLOW',
  'WORKSPACE',
  'CONNECTION',
  'SECURITY',
]);

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isNotificationLocale(value: unknown): value is NotificationLocale {
  return value === 'vi' || value === 'en';
}

function assertNotificationQuery(query: NotificationQuery): void {
  const allowed = new Set(['limit', 'cursor', 'unreadOnly', 'category', 'locale']);
  if (Object.keys(query as object).some((key) => !allowed.has(key))) {
    throw new Error('Invalid notification query.');
  }
  if (
    (query.limit !== undefined &&
      (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)) ||
    (query.cursor !== undefined &&
      (typeof query.cursor !== 'string' ||
        query.cursor.length === 0 ||
        query.cursor.length > 512)) ||
    (query.unreadOnly !== undefined && typeof query.unreadOnly !== 'boolean') ||
    (query.category !== undefined && !CATEGORIES.has(query.category)) ||
    (query.locale !== undefined && !isNotificationLocale(query.locale))
  ) {
    throw new Error('Invalid notification query.');
  }
}

export function buildNotificationListRequest(
  query: NotificationQuery = {},
  signal?: AbortSignal,
): AxiosRequestConfig {
  assertNotificationQuery(query);
  return {
    url: NOTIFICATIONS_V2_PATH,
    params: {
      limit: query.limit ?? 20,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      unreadOnly: query.unreadOnly ?? false,
      ...(query.category !== undefined ? { category: query.category } : {}),
      locale: query.locale ?? 'vi',
    },
    ...(signal ? { signal } : {}),
  };
}

export function buildNotificationUnreadCountRequest(
  signal?: AbortSignal,
): AxiosRequestConfig {
  return {
    url: `${NOTIFICATIONS_V2_PATH}/unread-count`,
    ...(signal ? { signal } : {}),
  };
}

export function buildNotificationReadRequest(
  id: string,
  locale: NotificationLocale = 'vi',
): AxiosRequestConfig {
  if (!isUuid(id)) throw new Error('Invalid notification id.');
  if (!isNotificationLocale(locale)) throw new Error('Invalid notification locale.');
  return {
    method: 'PATCH',
    url: `${NOTIFICATIONS_V2_PATH}/${id}/read`,
    params: { locale },
  };
}

export function buildNotificationReadAllRequest(): AxiosRequestConfig {
  return { method: 'POST', url: `${NOTIFICATIONS_V2_PATH}/read-all` };
}
