import type {
  NotificationInboxItem,
  NotificationPage,
  NotificationQuery,
} from '../types/notification.types';

function storageKey(userId: string) {
  return `weav_mock_notification_inbox_v2:${encodeURIComponent(userId)}`;
}

function readItems(userId: string): NotificationInboxItem[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter(
          (item): item is NotificationInboxItem =>
            typeof item === 'object' && item !== null &&
            typeof (item as NotificationInboxItem).id === 'string' &&
            typeof (item as NotificationInboxItem).title === 'string' &&
            typeof (item as NotificationInboxItem).message === 'string' &&
            typeof (item as NotificationInboxItem).createdAt === 'string' &&
            ((item as NotificationInboxItem).readAt === null ||
              typeof (item as NotificationInboxItem).readAt === 'string'),
        )
      : [];
  } catch {
    return [];
  }
}

function writeItems(userId: string, items: NotificationInboxItem[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    // Mock persistence is best-effort; production requests never use this adapter.
  }
}

export const notificationMockApi = {
  async getPage(userId: string, query: NotificationQuery): Promise<NotificationPage> {
    const items = readItems(userId)
      .filter((item) => !query.unreadOnly || item.readAt === null)
      .filter((item) => !query.category || item.category === query.category)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      );
    const cursorIndex = query.cursor
      ? items.findIndex((item) => item.id === query.cursor)
      : -1;
    const start = cursorIndex < 0 ? 0 : cursorIndex + 1;
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    const pageItems = items.slice(start, start + limit);
    return {
      items: pageItems,
      nextCursor: start + pageItems.length < items.length
        ? pageItems.at(-1)?.id ?? null
        : null,
    };
  },

  async getUnreadCount(userId: string) {
    return readItems(userId).filter((item) => item.readAt === null).length;
  },

  async markAsRead(userId: string, id: string) {
    const items = readItems(userId);
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return null;
    const updated = item.readAt === null
      ? { ...item, readAt: new Date().toISOString() }
      : item;
    writeItems(userId, items.map((candidate) => candidate.id === id ? updated : candidate));
    return updated;
  },

  async markAllAsRead(userId: string) {
    const items = readItems(userId);
    const readAt = new Date().toISOString();
    let updatedCount = 0;
    const updated = items.map((item) => {
      if (item.readAt !== null) return item;
      updatedCount += 1;
      return { ...item, readAt };
    });
    writeItems(userId, updated);
    return updatedCount;
  },
};
