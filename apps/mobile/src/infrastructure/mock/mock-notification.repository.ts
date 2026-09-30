import type {
  NotificationRepository,
  NotificationItem,
  NotificationQuery,
  NotificationInboxPage,
  NotificationSessionScope,
  NotificationLocale,
} from '../../domain/notification/notification.types';

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
const notificationId = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

const rowsByUser = new Map<string, NotificationItem[]>();

function makeSeed(locale: NotificationLocale): NotificationItem[] {
  const vi = locale === 'vi';
  return [
    {
      id: notificationId(10),
      eventType: 'workflow.completed',
      category: 'WORKFLOW',
      severity: 'SUCCESS',
      title: vi ? 'Quy trình đã hoàn tất' : 'Workflow run completed',
      message: vi ? 'Lượt chạy quy trình đã hoàn tất thành công.' : 'The workflow run completed successfully.',
      target: { kind: 'NONE' },
      workspaceId: null,
      executionId: null,
      occurredAt: '2026-09-27T04:00:00.000Z',
      createdAt: '2026-09-27T04:01:00.000Z',
      readAt: null,
    },
    {
      id: notificationId(9),
      eventType: 'workspace.member_removed',
      category: 'WORKSPACE',
      severity: 'WARNING',
      title: vi ? 'Quyền truy cập không gian đã thay đổi' : 'Workspace access changed',
      message: vi ? 'Bạn đã bị xóa khỏi một không gian làm việc.' : 'You were removed from a workspace.',
      target: { kind: 'NONE' },
      workspaceId: null,
      executionId: null,
      occurredAt: '2026-09-26T04:00:00.000Z',
      createdAt: '2026-09-26T04:01:00.000Z',
      readAt: null,
    },
    {
      id: notificationId(8),
      eventType: 'security.password_changed',
      category: 'SECURITY',
      severity: 'INFO',
      title: vi ? 'Mật khẩu đã được thay đổi' : 'Password changed',
      message: vi ? 'Mật khẩu tài khoản của bạn đã được cập nhật.' : 'Your account password was updated.',
      target: { kind: 'SECURITY_SETTINGS' },
      workspaceId: null,
      executionId: null,
      occurredAt: '2026-09-25T04:00:00.000Z',
      createdAt: '2026-09-25T04:01:00.000Z',
      readAt: '2026-09-25T04:02:00.000Z',
    },
  ];
}

function accountRows(scope: NotificationSessionScope): NotificationItem[] {
  const existing = rowsByUser.get(scope.userId);
  if (existing) return existing;
  const initial = makeSeed('en');
  rowsByUser.set(scope.userId, initial);
  return initial;
}

function localized(items: NotificationItem[], locale: NotificationLocale): NotificationItem[] {
  if (locale === 'en') return items.map((item) => ({ ...item, target: { ...item.target } }));
  const enToVi: Record<string, [string, string]> = {
    'Workflow run completed': ['Quy trình đã hoàn tất', 'Lượt chạy quy trình đã hoàn tất thành công.'],
    'Workspace access changed': ['Quyền truy cập không gian đã thay đổi', 'Bạn đã bị xóa khỏi một không gian làm việc.'],
    'Password changed': ['Mật khẩu đã được thay đổi', 'Mật khẩu tài khoản của bạn đã được cập nhật.'],
  };
  return items.map((item) => ({
    ...item,
    ...(enToVi[item.title]
      ? { title: enToVi[item.title][0], message: enToVi[item.title][1] }
      : {}),
    target: { ...item.target },
  }));
}

export class MockNotificationRepository implements NotificationRepository {
  async getNotifications(
    scope: NotificationSessionScope,
    locale: NotificationLocale = 'vi',
  ): Promise<NotificationItem[]> {
    return (await this.getNotificationPage(scope, { locale })).items;
  }

  async getNotificationPage(
    scope: NotificationSessionScope,
    query: NotificationQuery = {},
  ): Promise<NotificationInboxPage> {
    await delay();
    const locale = query.locale ?? 'vi';
    const list = localized(accountRows(scope), locale)
      .filter((item) => !query.unreadOnly || item.readAt === null)
      .filter((item) => !query.category || item.category === query.category)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
    const cursorIndex = query.cursor ? list.findIndex((item) => item.id === query.cursor) : -1;
    const start = cursorIndex < 0 ? 0 : cursorIndex + 1;
    const items = list.slice(start, start + Math.max(1, Math.min(query.limit ?? 20, 100)));
    return {
      items,
      nextCursor: start + items.length < list.length ? items.at(-1)?.id ?? null : null,
    };
  }

  async getUnreadCount(scope: NotificationSessionScope): Promise<number> {
    await delay(40);
    return accountRows(scope).filter((item) => item.readAt === null).length;
  }

  async markRead(
    id: string,
    scope: NotificationSessionScope,
    locale: NotificationLocale,
  ): Promise<NotificationItem> {
    await delay(40);
    const rows = accountRows(scope);
    const existing = rows.find((item) => item.id === id);
    if (!existing) throw { code: 'NOT_FOUND', message: 'The notification is no longer available.' };
    const updated = existing.readAt ? existing : { ...existing, readAt: new Date().toISOString() };
    rowsByUser.set(scope.userId, rows.map((item) => item.id === id ? updated : item));
    return localized([updated], locale)[0];
  }

  async markAllRead(scope: NotificationSessionScope): Promise<number> {
    await delay(60);
    const rows = accountRows(scope);
    const unreadCount = rows.filter((item) => item.readAt === null).length;
    const readAt = new Date().toISOString();
    rowsByUser.set(scope.userId, rows.map((item) => item.readAt ? item : { ...item, readAt }));
    return unreadCount;
  }
}
