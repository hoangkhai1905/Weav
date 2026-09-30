import { toast } from 'sonner';
import { useI18nStore } from '../../store/useI18nStore';
import { isCurrentNotificationSession } from '../notifications/session';
import type { NotificationSessionSnapshot } from '../notifications/session';

export function showSuccessToast(
  key: string,
  session?: NotificationSessionSnapshot,
) {
  if (session && !isCurrentNotificationSession(session)) return false;
  toast.success(useI18nStore.getState().t(key));
  return true;
}

export function showErrorToast(
  key: string,
  session?: NotificationSessionSnapshot,
) {
  if (session && !isCurrentNotificationSession(session)) return false;
  toast.error(useI18nStore.getState().t(key));
  return true;
}
