import axios, { type AxiosRequestConfig } from 'axios';
import type {
  NotificationRepository,
  NotificationItem,
  NotificationQuery,
  NotificationInboxPage,
} from '../../domain/notification/notification.types';
import { httpClient, normalizeApiError } from './http-client';
import {
  mapNotificationPage,
  type NotificationPage,
} from './notification.mapper';
import { useAuthStore } from '../../stores/auth.store';

async function requestNotification<T>(config: AxiosRequestConfig): Promise<T> {
  const token = useAuthStore.getState().tokens?.accessToken;
  try {
    return (await httpClient.request<T>(config)).data;
  } catch (error) {
    if (axios.isCancel(error))
      throw { code: 'CANCELED', message: 'Notification request canceled.' };
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      if (useAuthStore.getState().tokens?.accessToken === token) {
        useAuthStore.getState().clearAuthSession();
      }
      throw { code: 'UNAUTHORIZED', message: 'Please sign in again.' };
    }
    const normalized = normalizeApiError(error);
    // Do not retain raw Axios responses, which may include request credentials.
    throw {
      code: normalized.code,
      message: 'Unable to update notifications. Please try again.',
    };
  }
}

export class HttpNotificationRepository implements NotificationRepository {
  async getNotifications(): Promise<NotificationItem[]> {
    return (await this.getNotificationPage()).items;
  }

  async getNotificationPage(
    query: NotificationQuery = {},
    signal?: AbortSignal,
  ): Promise<NotificationInboxPage> {
    const page = await requestNotification<NotificationPage>({
      url: '/api/notifications',
      params: { limit: 20, ...query },
      signal,
    });
    if (
      !page ||
      !Array.isArray(page.items) ||
      (page.nextCursor !== null && typeof page.nextCursor !== 'string')
    ) {
      throw {
        code: 'INVALID_RESPONSE',
        message: 'Invalid notification response.',
      };
    }
    return { items: mapNotificationPage(page), nextCursor: page.nextCursor };
  }

  async getUnreadCount(signal?: AbortSignal): Promise<number> {
    const result = await requestNotification<{ count: number }>({
      url: '/api/notifications/unread-count',
      signal,
    });
    if (!Number.isSafeInteger(result?.count) || result.count < 0) {
      throw {
        code: 'INVALID_RESPONSE',
        message: 'Invalid unread count response.',
      };
    }
    return result.count;
  }

  async markRead(id: string): Promise<void> {
    await requestNotification({
      method: 'PATCH',
      url: `/api/notifications/${encodeURIComponent(id)}/read`,
    });
  }

  async markAllRead(): Promise<void> {
    await requestNotification({
      method: 'POST',
      url: '/api/notifications/read-all',
    });
  }
}
