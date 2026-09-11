import axios, { type AxiosRequestConfig } from 'axios';
import { delay, getStorage, setStorage, STORAGE_KEYS } from './client';
import { getStoredAuthToken } from './ocr.api';
import { useAuthStore } from '../store/useAuthStore';
import type { NotificationItem } from '../types/workflow.types';

export const isNotificationMockMode = import.meta.env.VITE_API_MODE === 'mock';

export interface NotificationQuery {
  limit?: number;
  cursor?: string;
  unreadOnly?: boolean;
  eventType?: string;
  status?: NotificationItem['status'];
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

interface NotificationDelivery {
  id: string;
  userId: string;
  executionId: string | null;
  provider: 'TELEGRAM' | 'EXPO_PUSH';
  eventType: 'workflow.completed' | 'workflow.failed';
  title: string;
  message: string;
  status: NonNullable<NotificationItem['status']>;
  read: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  sentAt: string | null;
}

export class NotificationApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      status === 401
        ? 'Please sign in again.'
        : 'Notifications are temporarily unavailable.',
    );
    this.name = 'NotificationApiError';
    this.status = status;
  }
}

const notificationHttpClient = axios.create({
  baseURL: (
    import.meta.env.VITE_API_GATEWAY_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, ''),
  timeout: 10000,
});

async function requestNotification<T>(config: AxiosRequestConfig): Promise<T> {
  const token = getStoredAuthToken();
  if (!token) throw new NotificationApiError(401);
  try {
    const response = await notificationHttpClient.request<T>({
      ...config,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (error) {
    if (axios.isCancel(error)) throw new NotificationApiError(0);
    const status = axios.isAxiosError(error)
      ? (error.response?.status ?? 0)
      : 0;
    if (status === 401 && getStoredAuthToken() === token) {
      useAuthStore.getState().logout();
    }
    // Do not retain the Axios config containing the Authorization header.
    throw new NotificationApiError(status);
  }
}

function mapDelivery(item: NotificationDelivery): NotificationItem {
  if (
    !item ||
    typeof item.id !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.message !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.read !== 'boolean' ||
    (item.executionId !== null && typeof item.executionId !== 'string') ||
    !['PENDING', 'SENDING', 'SENT', 'FAILED'].includes(item.status)
  ) {
    throw new NotificationApiError(502);
  }
  return {
    id: item.id,
    userId: item.userId,
    executionId: item.executionId,
    provider: item.provider,
    eventType: item.eventType,
    type:
      item.eventType === 'workflow.completed'
        ? 'WORKFLOW_COMPLETED'
        : 'WORKFLOW_FAILED',
    title: item.title,
    message: item.message,
    timestamp: item.createdAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    status: item.status,
    read: item.read,
    readAt: item.readAt,
    scheduledAt: item.scheduledAt,
    sentAt: item.sentAt,
    ...(item.executionId
      ? { link: `/executions/${encodeURIComponent(item.executionId)}` }
      : {}),
  };
}

async function getNotificationPage(
  query: NotificationQuery = {},
  signal?: AbortSignal,
): Promise<NotificationPage> {
  if (!isNotificationMockMode) {
    const page = await requestNotification<{
      items: NotificationDelivery[];
      nextCursor: string | null;
    }>({
      url: '/api/notifications',
      params: { limit: 20, ...query },
      signal,
    });
    if (
      !page ||
      !Array.isArray(page.items) ||
      (page.nextCursor !== null && typeof page.nextCursor !== 'string')
    ) {
      throw new NotificationApiError(502);
    }
    return { items: page.items.map(mapDelivery), nextCursor: page.nextCursor };
  }
  await delay(150);
  const list = getStorage<NotificationItem[]>(STORAGE_KEYS.NOTIFICATIONS, [])
    .filter((item) => !query.unreadOnly || !item.read)
    .filter((item) => !query.eventType || item.eventType === query.eventType)
    .filter((item) => !query.status || item.status === query.status)
    .sort(
      (a, b) =>
        b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id),
    );
  const start = query.cursor
    ? Math.max(0, list.findIndex((item) => item.id === query.cursor) + 1)
    : 0;
  const items = list.slice(
    start,
    start + Math.max(1, Math.min(query.limit ?? 20, 100)),
  );
  return {
    items,
    nextCursor:
      start + items.length < list.length ? (items.at(-1)?.id ?? null) : null,
  };
}

export const notificationApi = {
  getNotificationPage,

  async getNotifications(): Promise<NotificationItem[]> {
    return (await getNotificationPage()).items;
  },

  async getUnreadCount(signal?: AbortSignal): Promise<number> {
    if (!isNotificationMockMode) {
      const result = await requestNotification<{ count: number }>({
        url: '/api/notifications/unread-count',
        signal,
      });
      if (!Number.isSafeInteger(result?.count) || result.count < 0)
        throw new NotificationApiError(502);
      return result.count;
    }
    await delay(100);
    return getStorage<NotificationItem[]>(
      STORAGE_KEYS.NOTIFICATIONS,
      [],
    ).filter((item) => !item.read).length;
  },

  async markAsRead(id: string): Promise<void> {
    if (!isNotificationMockMode) {
      await requestNotification({
        method: 'PATCH',
        url: `/api/notifications/${encodeURIComponent(id)}/read`,
      });
      return;
    }
    await delay(100);
    const list = getStorage<NotificationItem[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    setStorage(
      STORAGE_KEYS.NOTIFICATIONS,
      list.map((item) =>
        item.id === id && !item.read
          ? { ...item, read: true, readAt: new Date().toISOString() }
          : item,
      ),
    );
  },

  async markAllAsRead(): Promise<void> {
    if (!isNotificationMockMode) {
      await requestNotification({
        method: 'POST',
        url: '/api/notifications/read-all',
      });
      return;
    }
    await delay(100);
    const list = getStorage<NotificationItem[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    const readAt = new Date().toISOString();
    setStorage(
      STORAGE_KEYS.NOTIFICATIONS,
      list.map((item) => (item.read ? item : { ...item, read: true, readAt })),
    );
  },
};
