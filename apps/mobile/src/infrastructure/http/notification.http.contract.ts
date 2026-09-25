import type { AxiosRequestConfig } from 'axios';
import type {
  NotificationQuery,
} from '../../domain/notification/notification.types';

export function buildNotificationListRequest(
  query: NotificationQuery = {},
  signal?: AbortSignal,
): AxiosRequestConfig {
  return {
    url: '/api/notifications',
    params: { limit: 20, ...query },
    signal,
  };
}

export function buildNotificationUnreadCountRequest(
  signal?: AbortSignal,
): AxiosRequestConfig {
  return { url: '/api/notifications/unread-count', signal };
}

export function buildNotificationReadRequest(id: string): AxiosRequestConfig {
  return {
    method: 'PATCH',
    url: `/api/notifications/${encodeURIComponent(id)}/read`,
  };
}

export function buildNotificationReadAllRequest(): AxiosRequestConfig {
  return { method: 'POST', url: '/api/notifications/read-all' };
}
