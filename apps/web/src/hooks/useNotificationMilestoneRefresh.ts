import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notificationKeys } from './useNotifications';
import {
  isCurrentNotificationSession,
  notificationSessionKey,
} from '../lib/notifications/session';
import type { NotificationSessionSnapshot } from '../lib/notifications/session';

export function useNotificationMilestoneRefresh() {
  const queryClient = useQueryClient();
  return useCallback((session: NotificationSessionSnapshot) => {
    if (!isCurrentNotificationSession(session)) return;
    void queryClient.invalidateQueries({
      queryKey: notificationKeys.session(notificationSessionKey(session)),
    });
  }, [queryClient]);
}
