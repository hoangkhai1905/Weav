import { useEffect, useRef } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  notificationApi,
  isNotificationMockMode,
  NotificationApiError,
} from '../api/notification.api';
import { getStoredAuthToken } from '../api/ocr.api';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import {
  notificationSessionKey,
} from '../lib/notifications/session';
import type {
  NotificationCategory,
  NotificationInboxItem,
  NotificationLocale,
  NotificationPage,
} from '../types/notification.types';

export const notificationKeys = {
  session: (sessionId: string) => ['notifications', sessionId] as const,
};

function useNotificationSession() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const token = getStoredAuthToken();
  const snapshot = { userId, token, authenticated };
  const sessionId = notificationSessionKey(snapshot);
  return {
    userId,
    queryKey: notificationKeys.session(sessionId),
    enabled: Boolean(authenticated && userId && (isNotificationMockMode || token)),
  };
}

export function useNotificationSessionCleanup() {
  const session = useNotificationSession();
  const queryClient = useQueryClient();
  const previousSessionId = useRef<string | null>(null);
  const currentSessionId = session.enabled
    ? session.queryKey[1] as string
    : null;

  useEffect(() => {
    const previous = previousSessionId.current;
    if (previous !== currentSessionId && previous) {
      const queryKey = notificationKeys.session(previous);
      void queryClient.cancelQueries({ queryKey });
      void queryClient.removeQueries({ queryKey });
    }
    if (!currentSessionId) {
      void queryClient.cancelQueries({ queryKey: ['notifications'] });
      void queryClient.removeQueries({ queryKey: ['notifications'] });
    }
    previousSessionId.current = currentSessionId;
  }, [currentSessionId, queryClient]);
}

// Never retry 4xx (including 429); a rate-limited request must not be repeated immediately.
const retryNotification = (count: number, error: Error) =>
  count < 1 &&
  !(error instanceof NotificationApiError && error.status >= 400 && error.status < 500);

function flattenPages(data: InfiniteData<NotificationPage>): NotificationInboxItem[] {
  const unique = new Map<string, NotificationInboxItem>();
  for (const page of data.pages) {
    for (const item of page.items) {
      if (!unique.has(item.id)) unique.set(item.id, item);
    }
  }
  return [...unique.values()];
}

export function useNotifications(filters: {
  category?: Exclude<NotificationCategory, 'UNKNOWN'>;
  unreadOnly?: boolean;
  locale?: NotificationLocale;
} = {}) {
  const session = useNotificationSession();
  const locale = filters.locale ?? (useI18nStore.getState().language === 'VI' ? 'vi' : 'en');
  const category = filters.category;
  const unreadOnly = filters.unreadOnly;
  const query = useInfiniteQuery({
    queryKey: [...session.queryKey, 'list', locale, category ?? 'all', unreadOnly ?? false],
    enabled: session.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      notificationApi.getNotificationPage({
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(category ? { category } : {}),
        ...(unreadOnly ? { unreadOnly: true } : {}),
        locale,
      }, signal),
    getNextPageParam: (page, _pages, cursor) =>
      page.nextCursor && page.nextCursor !== cursor ? page.nextCursor : undefined,
    select: flattenPages,
    retry: retryNotification,
    gcTime: 0,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  return { ...query, authRequired: !session.enabled };
}

export function useNotificationUnreadCount() {
  const session = useNotificationSession();
  return useQuery({
    queryKey: [...session.queryKey, 'unread-count'],
    enabled: session.enabled,
    queryFn: ({ signal }) => notificationApi.getUnreadCount(signal),
    retry: retryNotification,
    gcTime: 0,
    // 30s normally, 60s after a 429; react-query skips polling in hidden tabs by default.
    refetchInterval: (query) =>
      query.state.error instanceof NotificationApiError && query.state.error.status === 429 ? 60000 : 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead(locale: NotificationLocale = 'vi') {
  const queryClient = useQueryClient();
  const { queryKey } = useNotificationSession();
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  return useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id, locale),
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: invalidate,
    onError: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const { queryKey } = useNotificationSession();
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  return useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: invalidate,
    onError: invalidate,
  });
}
