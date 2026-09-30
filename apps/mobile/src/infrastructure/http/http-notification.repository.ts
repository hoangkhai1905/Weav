import axios, { type AxiosRequestConfig } from 'axios';
import type {
  NotificationRepository,
  NotificationItem,
  NotificationQuery,
  NotificationInboxPage,
  NotificationLocale,
  NotificationSessionScope,
} from '../../domain/notification/notification.types';
import { httpClient, normalizeApiError } from './http-client';
import { mapNotificationItem, mapNotificationPage } from './notification.mapper';
import {
  buildNotificationListRequest,
  buildNotificationReadAllRequest,
  buildNotificationReadRequest,
  buildNotificationUnreadCountRequest,
} from './notification.http.contract';
import { useAuthStore } from '../../stores/auth.store';
import { expirePersistedAuthSession } from '../auth/auth-session.persistence';

interface CapturedSession extends NotificationSessionScope {
  token: string;
}

function captureSession(scope: NotificationSessionScope): CapturedSession {
  const auth = useAuthStore.getState();
  const token = auth.tokens?.accessToken;
  if (
    !auth.isAuthenticated ||
    !token ||
    auth.user?.id !== scope.userId ||
    auth.sessionGeneration !== scope.generation
  ) {
    throw { code: 'STALE_SESSION', message: 'Notification session changed.' };
  }
  return { ...scope, token };
}

function isCapturedSessionCurrent(session: CapturedSession): boolean {
  const auth = useAuthStore.getState();
  return (
    auth.isAuthenticated &&
    auth.user?.id === session.userId &&
    auth.sessionGeneration === session.generation &&
    auth.tokens?.accessToken === session.token
  );
}

function safeError(error: unknown): { code: string; message: string; status?: number } {
  if (axios.isCancel(error)) {
    return { code: 'CANCELED', message: 'Notification request canceled.' };
  }
  const normalized = normalizeApiError(error);
  const rawCode = typeof normalized.code === 'string' ? normalized.code : 'INTERNAL_ERROR';
  const code = /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : 'INTERNAL_ERROR';
  const status =
    typeof normalized.status === 'number' &&
    Number.isInteger(normalized.status) &&
    normalized.status >= 400 &&
    normalized.status <= 599
      ? normalized.status
      : undefined;
  const messages: Record<string, string> = {
    BAD_REQUEST: 'The notification request was invalid.',
    UNAUTHORIZED: 'Please sign in again to load notifications.',
    FORBIDDEN: 'This notification action is not allowed.',
    NOT_FOUND: 'The notification is no longer available.',
    SERVICE_UNAVAILABLE: 'Notifications are temporarily unavailable.',
    CANCELED: 'Notification request canceled.',
  };
  return {
    code,
    message: messages[code] ?? 'Notification request failed. Please try again.',
    ...(status !== undefined ? { status } : {}),
  };
}

async function requestNotification<T>(
  scope: NotificationSessionScope,
  config: AxiosRequestConfig,
): Promise<T> {
  const session = captureSession(scope);
  try {
    const response = await httpClient.request<T>({
      ...config,
      headers: { ...config.headers, Authorization: `Bearer ${session.token}` },
    });
    if (!isCapturedSessionCurrent(session)) {
      throw { code: 'STALE_SESSION', message: 'Notification session changed.' };
    }
    return response.data;
  } catch (error) {
    if (axios.isCancel(error)) throw safeError(error);
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      if (isCapturedSessionCurrent(session)) {
        void expirePersistedAuthSession();
      }
      throw safeError(error);
    }
    if (!isCapturedSessionCurrent(session)) {
      throw { code: 'STALE_SESSION', message: 'Notification session changed.' };
    }
    throw safeError(error);
  }
}

function invalidResponse(message: string): never {
  throw { code: 'INVALID_RESPONSE', message };
}

export class HttpNotificationRepository implements NotificationRepository {
  async getNotifications(
    scope: NotificationSessionScope,
    locale: NotificationLocale = 'vi',
  ): Promise<NotificationItem[]> {
    return (await this.getNotificationPage(scope, { locale })).items;
  }

  async getNotificationPage(
    scope: NotificationSessionScope,
    query: NotificationQuery = {},
    signal?: AbortSignal,
  ): Promise<NotificationInboxPage> {
    const page = await requestNotification<unknown>(
      scope,
      buildNotificationListRequest(query, signal),
    );
    try {
      return mapNotificationPage(page);
    } catch {
      return invalidResponse('Invalid notification response.');
    }
  }

  async getUnreadCount(
    scope: NotificationSessionScope,
    signal?: AbortSignal,
  ): Promise<number> {
    const result = await requestNotification<unknown>(
      scope,
      buildNotificationUnreadCountRequest(signal),
    );
    if (
      typeof result !== 'object' ||
      result === null ||
      !Number.isSafeInteger((result as { count?: unknown }).count) ||
      (result as { count: number }).count < 0
    ) {
      return invalidResponse('Invalid unread count response.');
    }
    return (result as { count: number }).count;
  }

  async markRead(
    id: string,
    scope: NotificationSessionScope,
    locale: NotificationLocale,
  ): Promise<NotificationItem> {
    const result = await requestNotification<unknown>(
      scope,
      buildNotificationReadRequest(id, locale),
    );
    if (typeof result !== 'object' || result === null || !('item' in result)) {
      return invalidResponse('Invalid notification read response.');
    }
    try {
      return mapNotificationItem((result as { item: unknown }).item);
    } catch {
      return invalidResponse('Invalid notification read response.');
    }
  }

  async markAllRead(scope: NotificationSessionScope): Promise<number> {
    const result = await requestNotification<unknown>(
      scope,
      buildNotificationReadAllRequest(),
    );
    if (
      typeof result !== 'object' ||
      result === null ||
      !Number.isSafeInteger((result as { updatedCount?: unknown }).updatedCount) ||
      (result as { updatedCount: number }).updatedCount < 0
    ) {
      return invalidResponse('Invalid notification read-all response.');
    }
    return (result as { updatedCount: number }).updatedCount;
  }
}
