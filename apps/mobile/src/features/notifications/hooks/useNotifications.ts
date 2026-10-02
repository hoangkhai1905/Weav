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
  NotificationCategoryFilter,
  NotificationInboxPage,
  NotificationItem,
  NotificationLocale,
  NotificationSessionScope,
} from '../../../domain/notification/notification.types';
import {
  getNextNotificationCursor,
  notificationListQueryKey,
  notificationQueryKey,
  notificationUnreadCountQueryKey,
  type NotificationPageParam,
} from '../notification.query';
import { isAuthSessionScopeCurrent } from '../../auth/auth-session.scope';

function useNotificationSession() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const generation = useAuthStore((state) => state.sessionGeneration);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const hasToken = useAuthStore((state) => !!state.tokens?.accessToken);
  const scope: NotificationSessionScope | null = userId
    ? { userId, generation }
    : null;
  return {
    scope,
    enabled:
      authenticated &&
      Boolean(userId) &&
      (process.env.EXPO_PUBLIC_API_MODE === 'mock' || hasToken),
  };
}

const retryNotification = (count: number, error: unknown) =>
  count < 1 &&
  !(
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['UNAUTHORIZED', 'STALE_SESSION', 'CANCELED'].includes(String(error.code))
  );

const flattenPages = (
  data: InfiniteData<NotificationInboxPage, NotificationPageParam>,
): NotificationItem[] => {
  const unique = new Map<string, NotificationItem>();
  for (const page of data.pages) {
    for (const item of page.items) {
      if (!unique.has(item.id)) unique.set(item.id, item);
    }
  }
  return [...unique.values()];
};

export interface NotificationListFilters {
  locale: NotificationLocale;
  category: NotificationCategoryFilter | null;
  unreadOnly: boolean;
}

export function useNotifications(filters: NotificationListFilters) {
  const { scope, enabled } = useNotificationSession();
  const listKey = notificationListQueryKey(
    scope?.userId,
    scope?.generation ?? 0,
    filters.locale,
    filters.category,
    filters.unreadOnly,
  );
  return useInfiniteQuery<
    NotificationInboxPage,
    unknown,
    NotificationItem[],
    readonly unknown[],
    NotificationPageParam
  >({
    queryKey: listKey,
    enabled: enabled && Boolean(scope),
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) => {
      if (!scope) throw { code: 'STALE_SESSION', message: 'Notification session changed.' };
      return notificationRepository.getNotificationPage(
        scope,
        {
          cursor: pageParam,
          locale: filters.locale,
          category: filters.category ?? undefined,
          unreadOnly: filters.unreadOnly,
        },
        signal,
      );
    },
    getNextPageParam: getNextNotificationCursor,
    select: flattenPages,
    gcTime: 0,
    retry: retryNotification,
    refetchInterval: 30000,
  });
}

export function useNotificationUnreadCount() {
  const { scope, enabled } = useNotificationSession();
  return useQuery({
    queryKey: notificationUnreadCountQueryKey(scope?.userId, scope?.generation ?? 0),
    queryFn: ({ signal }) => {
      if (!scope) throw { code: 'STALE_SESSION', message: 'Notification session changed.' };
      return notificationRepository.getUnreadCount(scope, signal);
    },
    enabled: enabled && Boolean(scope),
    gcTime: 0,
    retry: retryNotification,
    refetchInterval: 10000,
  });
}

interface MarkReadVariables {
  id: string;
  locale: NotificationLocale;
  scope: NotificationSessionScope;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation<NotificationItem, unknown, MarkReadVariables>({
    mutationFn: ({ id, locale, scope }) =>
      notificationRepository.markRead(id, scope, locale),
    retry: false,
    onMutate: ({ scope }) =>
      queryClient.cancelQueries({ queryKey: notificationQueryKey(scope.userId, scope.generation) }),
    onSuccess: (_item, variables) => {
      if (!isAuthSessionScopeCurrent(variables.scope)) return;
      void queryClient.invalidateQueries({
        queryKey: notificationQueryKey(variables.scope.userId, variables.scope.generation),
      });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation<number, unknown, NotificationSessionScope>({
    mutationFn: (scope) => notificationRepository.markAllRead(scope),
    retry: false,
    onMutate: (scope) =>
      queryClient.cancelQueries({ queryKey: notificationQueryKey(scope.userId, scope.generation) }),
    onSuccess: (_updatedCount, scope) => {
      if (!isAuthSessionScopeCurrent(scope)) return;
      void queryClient.invalidateQueries({
        queryKey: notificationQueryKey(scope.userId, scope.generation),
      });
    },
  });
}
