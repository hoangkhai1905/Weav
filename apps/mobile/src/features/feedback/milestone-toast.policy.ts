import type { MilestoneToastKey } from './milestone-toast.copy';

interface MilestoneToastEffects {
  isCurrent(): boolean;
  show(key: MilestoneToastKey): void;
  refreshNotifications?: () => void;
}

export function commitMilestoneToastIfCurrent(
  key: MilestoneToastKey,
  effects: MilestoneToastEffects,
): boolean {
  if (!effects.isCurrent()) return false;
  effects.show(key);
  effects.refreshNotifications?.();
  return true;
}
