export type NotificationLocale = 'vi' | 'en';

export type NotificationCategory =
  | 'WORKFLOW'
  | 'WORKSPACE'
  | 'CONNECTION'
  | 'SECURITY'
  | 'UNKNOWN';

export type NotificationCategoryFilter = Exclude<NotificationCategory, 'UNKNOWN'>;

export type NotificationSeverity =
  | 'INFO'
  | 'SUCCESS'
  | 'WARNING'
  | 'ERROR'
  | 'UNKNOWN';

export type NotificationTarget =
  | { kind: 'WORKFLOW'; workspaceId: string; workflowId: string }
  | { kind: 'EXECUTION'; workspaceId: string; executionId: string }
  | { kind: 'WORKSPACE'; workspaceId: string }
  | { kind: 'CONNECTION'; workspaceId: string; connectionId: string }
  | { kind: 'SECURITY_SETTINGS' }
  | { kind: 'NONE' };

/** The opaque account/session identity used to fence requests and cached results. */
export interface NotificationSessionScope {
  userId: string;
  generation: number;
}

/** Server-authored inbox summary. It deliberately contains no URL or delivery state. */
export interface NotificationItem {
  id: string;
  eventType: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  target: NotificationTarget;
  workspaceId: string | null;
  executionId: string | null;
  occurredAt: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationQuery {
  limit?: number;
  cursor?: string;
  unreadOnly?: boolean;
  category?: NotificationCategoryFilter;
  locale?: NotificationLocale;
}

export interface NotificationInboxPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

export interface NotificationRepository {
  /** Compatibility convenience for callers that need the first localized inbox page. */
  getNotifications(
    scope: NotificationSessionScope,
    locale?: NotificationLocale,
  ): Promise<NotificationItem[]>;
  getNotificationPage(
    scope: NotificationSessionScope,
    query?: NotificationQuery,
    signal?: AbortSignal,
  ): Promise<NotificationInboxPage>;
  getUnreadCount(
    scope: NotificationSessionScope,
    signal?: AbortSignal,
  ): Promise<number>;
  markRead(
    id: string,
    scope: NotificationSessionScope,
    locale: NotificationLocale,
  ): Promise<NotificationItem>;
  markAllRead(scope: NotificationSessionScope): Promise<number>;
}
