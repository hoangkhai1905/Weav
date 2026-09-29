export type NotificationLocale = 'vi' | 'en';

export type NotificationCategory =
  | 'WORKFLOW'
  | 'WORKSPACE'
  | 'CONNECTION'
  | 'SECURITY'
  | 'UNKNOWN';

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
  | { kind: 'NONE' }
  | { kind: 'UNKNOWN' };

export interface NotificationInboxItem {
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

export interface NotificationPage {
  items: NotificationInboxItem[];
  nextCursor: string | null;
}

export interface NotificationQuery {
  limit?: number;
  cursor?: string;
  unreadOnly?: boolean;
  category?: Exclude<NotificationCategory, 'UNKNOWN'>;
  locale?: NotificationLocale;
}
