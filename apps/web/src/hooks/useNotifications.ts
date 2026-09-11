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

function useNotificationSession() {
  const userId = useAuthStore((state) => state.user?.id);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  return {
    queryKey: ['notifications', userId ?? 'anonymous'],
    enabled:
      authenticated && (isNotificationMockMode || !!getStoredAuthToken()),
  };
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
  return useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id),
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const { queryKey } = useNotificationSession();
  return useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
}
