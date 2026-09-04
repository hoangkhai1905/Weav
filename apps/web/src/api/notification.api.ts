import { delay, getStorage, setStorage, STORAGE_KEYS } from './client';
import type { NotificationItem } from '../types/workflow.types';

export const notificationApi = {
  async getNotifications(): Promise<NotificationItem[]> {
    await delay(150);
    return getStorage<NotificationItem[]>(STORAGE_KEYS.NOTIFICATIONS, []);
  },

  async markAsRead(id: string): Promise<void> {
    await delay(100);
    const list = getStorage<NotificationItem[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      list[idx].read = true;
      setStorage(STORAGE_KEYS.NOTIFICATIONS, list);
    }
  },

  async markAllAsRead(): Promise<void> {
    await delay(100);
    const list = getStorage<NotificationItem[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    list.forEach((n) => (n.read = true));
    setStorage(STORAGE_KEYS.NOTIFICATIONS, list);
  },
};
