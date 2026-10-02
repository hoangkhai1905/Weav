import { useI18nStore } from '../../stores/i18n.store';
import { useUIStore } from '../../stores/ui.store';
import type { NotificationSessionScope } from '../../domain/notification/notification.types';
import { isAuthSessionScopeCurrent } from '../auth/auth-session.scope';
import { getMilestoneToastCopy, type MilestoneToastKey } from './milestone-toast.copy';
import { commitMilestoneToastIfCurrent } from './milestone-toast.policy';

export { getMilestoneToastCopy, type MilestoneToastKey } from './milestone-toast.copy';

export function showMilestoneToast(key: MilestoneToastKey): void {
  const language = useI18nStore.getState().language;
  useUIStore.getState().showToast({
    type: 'success',
    ...getMilestoneToastCopy(key, language),
  });
}

export function showMilestoneToastForSession(
  scope: NotificationSessionScope,
  key: MilestoneToastKey,
  refreshNotifications?: () => void,
): boolean {
  return commitMilestoneToastIfCurrent(key, {
    isCurrent: () => isAuthSessionScopeCurrent(scope),
    show: showMilestoneToast,
    refreshNotifications,
  });
}
