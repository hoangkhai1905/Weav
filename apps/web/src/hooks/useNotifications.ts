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
  type NotificationPage,
} from '../api/notification.api';
import { getStoredAuthToken } from '../api/ocr.api';
import { useAuthStore } from '../store/useAuthStore';
import type { NotificationItem } from '../types/workflow.types';

export const notificationKeys = {
  session: (userId: string) => ['notifications', userId] as const,
};

function useNotificationSession() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  return {
    userId,
    queryKey: notificationKeys.session(userId ?? 'anonymous'),
    enabled:
      Boolean(
        authenticated &&
          userId &&
          (isNotificationMockMode || !!getStoredAuthToken()),
      ),
  };
}

export function useNotificationSessionCleanup() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousUserId.current;
    if (previous === userId) return;

    if (previous) {
      void queryClient.removeQueries({ queryKey: notificationKeys.session(previous) });
    }
    if (!userId) {
      void queryClient.removeQueries({ queryKey: ['notifications'] });
    }

    previousUserId.current = userId;
  }, [queryClient, userId]);
}

const retryNotification = (count: number, error: Error) =>
  count < 1 &&
  !(
    error instanceof NotificationApiError &&
    error.status >= 400 &&
    error.status < 500
  );

function flattenPages(
  data: InfiniteData<NotificationPage>,
): NotificationItem[] {
  const unique = new Map<string, NotificationItem>();
  for (const page of data.pages) {
    for (const item of page.items)
      if (!unique.has(item.id)) unique.set(item.id, item);
  }
  return [...unique.values()];
}

export function useNotifications() {
  const session = useNotificationSession();
  const query = useInfiniteQuery({
    queryKey: [...session.queryKey, 'list'],
    enabled: session.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      notificationApi.getNotificationPage({ cursor: pageParam }, signal),
    getNextPageParam: (page, _pages, cursor) =>
      page.nextCursor && page.nextCursor !== cursor
        ? page.nextCursor
        : undefined,
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
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const { queryKey } = useNotificationSession();
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  return useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id),
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
