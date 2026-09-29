import type {
  NotificationCategoryFilter,
  NotificationInboxPage,
  NotificationLocale,
} from '../../domain/notification/notification.types';

export type NotificationPageParam = string | undefined;
export type NotificationQueryKey = readonly ['notifications', string, number];

export const notificationQueryKey = (
  userId: string | null | undefined,
  generation = 0,
): NotificationQueryKey => ['notifications', userId ?? 'anonymous', generation];

export const notificationListQueryKey = (
  userId: string | null | undefined,
  generation: number,
  locale: NotificationLocale,
  category: NotificationCategoryFilter | null,
  unreadOnly: boolean,
) => [
  ...notificationQueryKey(userId, generation),
  'list',
  { locale, category, unreadOnly },
] as const;

export const notificationUnreadCountQueryKey = (
  userId: string | null | undefined,
  generation: number,
) => [...notificationQueryKey(userId, generation), 'unread-count'] as const;

export function getNextNotificationCursor(
  lastPage: NotificationInboxPage,
  _allPages: NotificationInboxPage[],
  _lastPageParam: NotificationPageParam,
  allPageParams: NotificationPageParam[] = [],
): NotificationPageParam {
  const cursor = lastPage.nextCursor;
  return cursor && !allPageParams.includes(cursor) ? cursor : undefined;
}
