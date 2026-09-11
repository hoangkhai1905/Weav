import type {
  NotificationRepository,
  NotificationItem,
  NotificationQuery,
  NotificationInboxPage,
} from '../../domain/notification/notification.types';
import { MOCK_NOTIFICATIONS } from './mock-data';

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

let notifStore = [...MOCK_NOTIFICATIONS];

export class MockNotificationRepository implements NotificationRepository {
  async getNotifications(): Promise<NotificationItem[]> {
    await delay(300);
    return [...notifStore];
  }

  async getNotificationPage(
    query: NotificationQuery = {},
  ): Promise<NotificationInboxPage> {
    const list = (await this.getNotifications())
      .filter((item) => !query.unreadOnly || !item.read)
      .filter((item) => !query.eventType || item.eventType === query.eventType)
      .filter((item) => !query.status || item.status === query.status)
      .sort((a, b) => {
        const first = Date.parse(a.timestamp);
        const second = Date.parse(b.timestamp);
        return Number.isNaN(first) || Number.isNaN(second)
          ? 0
          : second - first || b.id.localeCompare(a.id);
      });
    const start = query.cursor
      ? Math.max(0, list.findIndex((item) => item.id === query.cursor) + 1)
      : 0;
    const items = list.slice(
      start,
      start + Math.max(1, Math.min(query.limit ?? 20, 100)),
    );
    return {
      items,
      nextCursor:
        start + items.length < list.length ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getUnreadCount(): Promise<number> {
    return (await this.getNotifications()).filter((item) => !item.read).length;
  }

  async markRead(id: string): Promise<void> {
    await delay(200);
    notifStore = notifStore.map((n) =>
      n.id === id && !n.read
        ? { ...n, read: true, readAt: new Date().toISOString() }
        : n,
    );
  }

  async markAllRead(): Promise<void> {
    await delay(250);
    notifStore = notifStore.map((n) =>
      n.read ? n : { ...n, read: true, readAt: new Date().toISOString() },
    );
  }
}
