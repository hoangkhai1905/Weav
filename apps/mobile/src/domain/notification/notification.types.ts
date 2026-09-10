export type NotificationType =
  | 'WORKFLOW_COMPLETED'
  | 'WORKFLOW_FAILED'
  | 'WORKFLOW_PAUSED'
  | 'WORKFLOW_RESUMED'
  | 'TELEGRAM_LINKED'
  | 'CONNECTION_EXPIRED';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  link?: string;
  userId?: string;
  executionId?: string | null;
  eventType?: string;
  provider?: 'TELEGRAM' | 'EXPO_PUSH';
  status?: NotificationStatus;
  readAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string | null;
  sentAt?: string | null;
}

export type NotificationStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';

export interface NotificationQuery {
  limit?: number;
  cursor?: string;
  unreadOnly?: boolean;
  eventType?: string;
  status?: NotificationStatus;
}

export interface NotificationInboxPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

export interface NotificationRepository {
  getNotifications(): Promise<NotificationItem[]>;
  getNotificationPage(
    query?: NotificationQuery,
    signal?: AbortSignal,
  ): Promise<NotificationInboxPage>;
  getUnreadCount(signal?: AbortSignal): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}
