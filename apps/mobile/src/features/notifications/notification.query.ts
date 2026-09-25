import type { NotificationInboxPage } from '../../domain/notification/notification.types';

export type NotificationPageParam = string | undefined;
export type NotificationQueryKey = readonly ['notifications', string];

export const notificationQueryKey = (
  userId: string | null | undefined,
): NotificationQueryKey => ['notifications', userId ?? 'anonymous'];

export function getNextNotificationCursor(
  lastPage: NotificationInboxPage,
  _allPages: NotificationInboxPage[],
  lastPageParam: NotificationPageParam,
): NotificationPageParam {
  return lastPage.nextCursor && lastPage.nextCursor !== lastPageParam
    ? lastPage.nextCursor
    : undefined;
}
