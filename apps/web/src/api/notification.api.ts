import axios, { type AxiosRequestConfig } from 'axios';
import { notificationMockApi } from './notification.mock.api';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import {
  captureNotificationSession,
  isCurrentNotificationSession,
} from '../lib/notifications/session';
import type {
  NotificationInboxItem,
  NotificationLocale,
  NotificationPage,
  NotificationQuery,
  NotificationTarget,
} from '../types/notification.types';
import { tr } from '../lib/i18n/tr';

export const isNotificationMockMode = import.meta.env.VITE_API_MODE === 'mock';

export class NotificationApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      status === 401
        ? tr('msg.please_sign_in_again')
        : tr('msg.notifications_are_temporarily_unavailable'),
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ['WORKFLOW', 'WORKSPACE', 'CONNECTION', 'SECURITY'] as const;
const SEVERITIES = ['INFO', 'SUCCESS', 'WARNING', 'ERROR'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parseTarget(value: unknown): NotificationTarget {
  if (!isRecord(value) || typeof value.kind !== 'string') return { kind: 'UNKNOWN' };
  switch (value.kind) {
    case 'WORKFLOW':
      return isUuid(value.workspaceId) && isUuid(value.workflowId)
        ? { kind: 'WORKFLOW', workspaceId: value.workspaceId, workflowId: value.workflowId }
        : { kind: 'UNKNOWN' };
    case 'EXECUTION':
      return isUuid(value.workspaceId) && isUuid(value.executionId)
        ? { kind: 'EXECUTION', workspaceId: value.workspaceId, executionId: value.executionId }
        : { kind: 'UNKNOWN' };
    case 'WORKSPACE':
      return isUuid(value.workspaceId)
        ? { kind: 'WORKSPACE', workspaceId: value.workspaceId }
        : { kind: 'UNKNOWN' };
    case 'CONNECTION':
      return isUuid(value.workspaceId) && isUuid(value.connectionId)
        ? { kind: 'CONNECTION', workspaceId: value.workspaceId, connectionId: value.connectionId }
        : { kind: 'UNKNOWN' };
    case 'SECURITY_SETTINGS':
      return { kind: 'SECURITY_SETTINGS' };
    case 'NONE':
      return { kind: 'NONE' };
    default:
      return { kind: 'UNKNOWN' };
  }
}

function parseNotification(value: unknown): NotificationInboxItem {
  if (
    !isRecord(value) || !isUuid(value.id) ||
    typeof value.eventType !== 'string' || value.eventType.length === 0 ||
    typeof value.category !== 'string' || typeof value.severity !== 'string' ||
    typeof value.title !== 'string' || typeof value.message !== 'string' ||
    !isTimestamp(value.occurredAt) || !isTimestamp(value.createdAt) ||
    (value.workspaceId !== null && !isUuid(value.workspaceId)) ||
    (value.executionId !== null && !isUuid(value.executionId)) ||
    (value.readAt !== null && !isTimestamp(value.readAt))
  ) {
    throw new NotificationApiError(502);
  }

  const parsedTarget = value.eventType === 'workspace.member_removed'
    ? { kind: 'NONE' as const }
    : parseTarget(value.target);
  const target = 'workspaceId' in parsedTarget &&
    (parsedTarget.workspaceId !== value.workspaceId ||
      (parsedTarget.kind === 'EXECUTION' && parsedTarget.executionId !== value.executionId))
    ? { kind: 'UNKNOWN' as const }
    : parsedTarget;

  return {
    id: value.id,
    eventType: value.eventType,
    category: CATEGORIES.includes(value.category as (typeof CATEGORIES)[number])
      ? value.category as NotificationInboxItem['category']
      : 'UNKNOWN',
    severity: SEVERITIES.includes(value.severity as (typeof SEVERITIES)[number])
      ? value.severity as NotificationInboxItem['severity']
      : 'UNKNOWN',
    title: value.title,
    message: value.message,
    target,
    workspaceId: value.workspaceId,
    executionId: value.executionId,
    occurredAt: value.occurredAt,
    createdAt: value.createdAt,
    readAt: value.readAt,
  };
}

async function requestNotification<T>(config: AxiosRequestConfig): Promise<T> {
  const session = captureNotificationSession();
  const token = session.token;
  if (!session.authenticated || !session.userId || !token) {
    throw new NotificationApiError(401);
  }

  let data: T;
  try {
    const response = await notificationHttpClient.request<T>({
      ...config,
      headers: { Authorization: `Bearer ${token}` },
    });
    data = response.data;
  } catch (error) {
    if (axios.isCancel(error)) throw new NotificationApiError(0);
    const status = axios.isAxiosError(error)
      ? (error.response?.status ?? 0)
      : error instanceof NotificationApiError ? error.status : 0;
    if (status === 401 && isCurrentNotificationSession(session)) {
      useAuthStore.getState().logout();
    }
    throw new NotificationApiError(status);
  }

  if (!isCurrentNotificationSession(session)) throw new NotificationApiError(0);
  return data;
}

function currentLocale(): NotificationLocale {
  return useI18nStore.getState().language === 'VI' ? 'vi' : 'en';
}

function requireMockUserId() {
  const session = captureNotificationSession();
  if (!session.authenticated || !session.userId) throw new NotificationApiError(401);
  return session.userId;
}

export const notificationApi = {
  async getNotificationPage(
    query: NotificationQuery = {},
    signal?: AbortSignal,
  ): Promise<NotificationPage> {
    const locale = query.locale ?? currentLocale();
    const requestQuery: NotificationQuery = { ...query, locale };
    if (isNotificationMockMode) {
      return notificationMockApi.getPage(requireMockUserId(), requestQuery);
    }

    const page = await requestNotification<unknown>({
      url: '/api/v2/notifications',
      params: {
        limit: requestQuery.limit ?? 20,
        ...(requestQuery.cursor !== undefined ? { cursor: requestQuery.cursor } : {}),
        ...(requestQuery.unreadOnly !== undefined ? { unreadOnly: requestQuery.unreadOnly } : {}),
        ...(requestQuery.category ? { category: requestQuery.category } : {}),
        locale,
      },
      signal,
    });
    if (
      !isRecord(page) || !Array.isArray(page.items) ||
      (page.nextCursor !== null && typeof page.nextCursor !== 'string')
    ) {
      throw new NotificationApiError(502);
    }
    return {
      items: page.items.map(parseNotification),
      nextCursor: page.nextCursor,
    };
  },

  async getUnreadCount(signal?: AbortSignal): Promise<number> {
    if (isNotificationMockMode) {
      return notificationMockApi.getUnreadCount(requireMockUserId());
    }
    const result = await requestNotification<unknown>({
      url: '/api/v2/notifications/unread-count',
      signal,
    });
    if (!isRecord(result) || !Number.isSafeInteger(result.count) || (result.count as number) < 0) {
      throw new NotificationApiError(502);
    }
    return result.count as number;
  },

  async markAsRead(id: string, locale = currentLocale()): Promise<NotificationInboxItem> {
    if (!isUuid(id)) throw new NotificationApiError(400);
    if (isNotificationMockMode) {
      const item = await notificationMockApi.markAsRead(requireMockUserId(), id);
      if (!item) throw new NotificationApiError(404);
      return item;
    }
    const result = await requestNotification<unknown>({
      method: 'PATCH',
      url: `/api/v2/notifications/${encodeURIComponent(id)}/read`,
      params: { locale },
    });
    if (!isRecord(result) || !('item' in result)) throw new NotificationApiError(502);
    return parseNotification(result.item);
  },

  async markAllAsRead(): Promise<number> {
    if (isNotificationMockMode) {
      return notificationMockApi.markAllAsRead(requireMockUserId());
    }
    const result = await requestNotification<unknown>({
      method: 'POST',
      url: '/api/v2/notifications/read-all',
    });
    if (!isRecord(result) || !Number.isSafeInteger(result.updatedCount) || (result.updatedCount as number) < 0) {
      throw new NotificationApiError(502);
    }
    return result.updatedCount as number;
  },
};
