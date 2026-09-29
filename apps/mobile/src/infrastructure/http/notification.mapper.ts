import type {
  NotificationCategory,
  NotificationInboxPage,
  NotificationItem,
  NotificationSeverity,
  NotificationTarget,
} from '../../domain/notification/notification.types';

type UnknownRecord = Record<string, unknown>;

const CATEGORIES = new Set(['WORKFLOW', 'WORKSPACE', 'CONNECTION', 'SECURITY']);
const SEVERITIES = new Set(['INFO', 'SUCCESS', 'WARNING', 'ERROR']);
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function nullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function mapCategory(value: unknown): NotificationCategory {
  return typeof value === 'string' && CATEGORIES.has(value)
    ? (value as NotificationCategory)
    : 'UNKNOWN';
}

function mapSeverity(value: unknown): NotificationSeverity {
  return typeof value === 'string' && SEVERITIES.has(value)
    ? (value as NotificationSeverity)
    : 'UNKNOWN';
}

function mapTarget(
  value: unknown,
  eventType: string,
  workspaceId: string | null,
  executionId: string | null,
): NotificationTarget {
  if (eventType === 'workspace.member_removed' || !isRecord(value)) {
    return { kind: 'NONE' };
  }

  switch (value.kind) {
    case 'WORKFLOW':
      return isUuid(value.workspaceId) &&
        isUuid(value.workflowId) &&
        workspaceId === value.workspaceId &&
        executionId === null
        ? { kind: 'WORKFLOW', workspaceId: value.workspaceId, workflowId: value.workflowId }
        : { kind: 'NONE' };
    case 'EXECUTION':
      return isUuid(value.workspaceId) &&
        isUuid(value.executionId) &&
        workspaceId === value.workspaceId &&
        executionId === value.executionId
        ? { kind: 'EXECUTION', workspaceId: value.workspaceId, executionId: value.executionId }
        : { kind: 'NONE' };
    case 'WORKSPACE':
      return isUuid(value.workspaceId) &&
        workspaceId === value.workspaceId &&
        executionId === null
        ? { kind: 'WORKSPACE', workspaceId: value.workspaceId }
        : { kind: 'NONE' };
    case 'CONNECTION':
      return isUuid(value.workspaceId) &&
        isUuid(value.connectionId) &&
        workspaceId === value.workspaceId &&
        executionId === null
        ? { kind: 'CONNECTION', workspaceId: value.workspaceId, connectionId: value.connectionId }
        : { kind: 'NONE' };
    case 'SECURITY_SETTINGS':
      return workspaceId === null && executionId === null
        ? { kind: 'SECURITY_SETTINGS' }
        : { kind: 'NONE' };
    case 'NONE':
    default:
      return { kind: 'NONE' };
  }
}

export function mapNotificationItem(value: unknown): NotificationItem {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.eventType !== 'string' ||
    value.eventType.length === 0 ||
    typeof value.title !== 'string' ||
    typeof value.message !== 'string' ||
    !nullableUuid(value.workspaceId) ||
    !nullableUuid(value.executionId) ||
    !isTimestamp(value.occurredAt) ||
    !isTimestamp(value.createdAt) ||
    !(value.readAt === null || isTimestamp(value.readAt))
  ) {
    throw new Error('Invalid notification response.');
  }

  return {
    id: value.id as string,
    eventType: value.eventType as string,
    category: mapCategory(value.category),
    severity: mapSeverity(value.severity),
    title: value.title as string,
    message: value.message as string,
    target: mapTarget(value.target, value.eventType as string, value.workspaceId as string | null, value.executionId as string | null),
    workspaceId: value.workspaceId as string | null,
    executionId: value.executionId as string | null,
    occurredAt: value.occurredAt as string,
    createdAt: value.createdAt as string,
    readAt: value.readAt as string | null,
  };
}

export function mapNotificationPage(value: unknown): NotificationInboxPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !(value.nextCursor === null ||
      (typeof value.nextCursor === 'string' &&
        value.nextCursor.length > 0 &&
        value.nextCursor.length <= 512))
  ) {
    throw new Error('Invalid notification response.');
  }
  return {
    items: value.items.map(mapNotificationItem),
    nextCursor: value.nextCursor as string | null,
  };
}
