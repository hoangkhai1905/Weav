import type {
  NotificationItem,
  NotificationStatus,
} from '../../domain/notification/notification.types';

export interface NotificationDelivery {
  id: string;
  userId: string;
  executionId: string | null;
  provider: 'TELEGRAM' | 'EXPO_PUSH';
  eventType: 'workflow.completed' | 'workflow.failed';
  title: string;
  message: string;
  status: NotificationStatus;
  read: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  sentAt: string | null;
}

export interface NotificationPage {
  items: NotificationDelivery[];
  nextCursor: string | null;
}
export function mapNotificationPage(
  page: NotificationPage,
): NotificationItem[] {
  if (
    page.items.some(
      (item) =>
        !item ||
        typeof item.id !== 'string' ||
        typeof item.title !== 'string' ||
        typeof item.message !== 'string' ||
        typeof item.createdAt !== 'string' ||
        typeof item.read !== 'boolean' ||
        (item.executionId !== null && typeof item.executionId !== 'string') ||
        (item.status !== undefined &&
          !['PENDING', 'SENDING', 'SENT', 'FAILED'].includes(item.status)),
    )
  ) {
    throw new Error('Invalid notification response.');
  }
  return page.items.map((item) => ({
    id: item.id,
    type:
      item.eventType === 'workflow.completed'
        ? 'WORKFLOW_COMPLETED'
        : 'WORKFLOW_FAILED',
    title: item.title,
    message: item.message,
    timestamp: item.createdAt,
    read: item.read,
    userId: item.userId,
    executionId: item.executionId,
    eventType: item.eventType,
    provider: item.provider,
    status: item.status,
    readAt: item.readAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    scheduledAt: item.scheduledAt,
    sentAt: item.sentAt,
    ...(item.executionId
      ? { link: `/(app)/executions/${encodeURIComponent(item.executionId)}` }
      : {}),
  }));
}
