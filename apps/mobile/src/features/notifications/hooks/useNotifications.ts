import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { notificationRepository } from '../../../infrastructure/repository-factory';
import { useAuthStore } from '../../../stores/auth.store';
import type {
  NotificationInboxPage,
  NotificationItem,
} from '../../../domain/notification/notification.types';

function useNotificationSession() {
  const userId = useAuthStore((state) => state.user?.id);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const hasToken = useAuthStore((state) => !!state.tokens?.accessToken);
  return {
    queryKey: ['notifications', userId ?? 'anonymous'],
    enabled:
      authenticated &&
      (process.env.EXPO_PUBLIC_API_MODE === 'mock' || hasToken),
  };
}

const retryNotification = (count: number, error: unknown) =>
  count < 1 &&
  !(
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'UNAUTHORIZED'
  );

const flattenPages = (
  data: InfiniteData<NotificationInboxPage>,
): NotificationItem[] => {
  const unique = new Map<string, NotificationItem>();
  for (const page of data.pages) {
    for (const item of page.items)
      if (!unique.has(item.id)) unique.set(item.id, item);
  }
  return [...unique.values()];
};

export function useNotifications() {
  const session = useNotificationSession();
  return useInfiniteQuery({
    queryKey: [...session.queryKey, 'list'],
    enabled: session.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      notificationRepository.getNotificationPage({ cursor: pageParam }, signal),
    getNextPageParam: (page, _pages, cursor) =>
      page.nextCursor && page.nextCursor !== cursor
        ? page.nextCursor
        : undefined,
    select: flattenPages,
    gcTime: 0,
    retry: retryNotification,
    refetchInterval: 30000,
  });
}

export function useNotificationUnreadCount() {
  const session = useNotificationSession();
  return useQuery({
    queryKey: [...session.queryKey, 'unread-count'],
    queryFn: ({ signal }) => notificationRepository.getUnreadCount(signal),
    enabled: session.enabled,
    gcTime: 0,
    retry: retryNotification,
    refetchInterval: 10000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const { queryKey } = useNotificationSession();
  return useMutation({
    mutationFn: (id: string) => notificationRepository.markRead(id),
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const { queryKey } = useNotificationSession();
  return useMutation({
    mutationFn: () => notificationRepository.markAllRead(),
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
}
