import { randomUUID } from 'node:crypto';
import { loadSettings } from '../config/settings';
import { DeliveryRepository, publicPayload } from '../domain/notification';
import type { Delivery, ExecutionEvent } from '../domain/notification';

export function testSettings() {
  return loadSettings({
    DB_HOST: '127.0.0.1',
    DB_NAME: 'test',
    DB_USERNAME: 'test',
    DB_PASSWORD: 'test-only',
    JWT_ACCESS_SECRET: 'test-only-key-not-for-production-123456',
    NOTIFICATION_TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: 'test-only',
    NOTIFICATION_EXPO_ENABLED: 'true',
  });
}
export function testEvent(): ExecutionEvent {
  const id = randomUUID();
  return {
    eventId: randomUUID(),
    eventType: 'workflow.completed',
    aggregateType: 'workflow_execution',
    aggregateId: id,
    occurredAt: new Date().toISOString(),
    payload: {
      executionId: id,
      workflowId: randomUUID(),
      userId: randomUUID(),
      workspaceId: randomUUID(),
      workflowName: 'Test workflow',
      status: 'SUCCESS',
      finishedAt: new Date().toISOString(),
      recipients: [{ provider: 'TELEGRAM', destination: '12345' }],
    },
  };
}
export function testDelivery(): Delivery {
  const event = testEvent();
  return {
    id: randomUUID(),
    sourceEventId: event.eventId,
    userId: event.payload.userId,
    executionId: event.payload.executionId,
    provider: 'TELEGRAM',
    destination: '12345',
    eventType: event.eventType,
    payload: publicPayload(event),
    status: 'SENDING',
    retryCount: 1,
    lastError: null,
    scheduledAt: null,
    sentAt: null,
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
export function mockRepository(): {
  [K in keyof DeliveryRepository]: jest.Mock<
    ReturnType<DeliveryRepository[K]>,
    Parameters<DeliveryRepository[K]>
  >;
} {
  return {
    ingest: jest.fn<
      ReturnType<DeliveryRepository['ingest']>,
      Parameters<DeliveryRepository['ingest']>
    >(),
    list: jest.fn<
      ReturnType<DeliveryRepository['list']>,
      Parameters<DeliveryRepository['list']>
    >(),
    unreadCount: jest.fn<
      ReturnType<DeliveryRepository['unreadCount']>,
      Parameters<DeliveryRepository['unreadCount']>
    >(),
    markRead: jest.fn<
      ReturnType<DeliveryRepository['markRead']>,
      Parameters<DeliveryRepository['markRead']>
    >(),
    markAllRead: jest.fn<
      ReturnType<DeliveryRepository['markAllRead']>,
      Parameters<DeliveryRepository['markAllRead']>
    >(),
    claim: jest.fn<
      ReturnType<DeliveryRepository['claim']>,
      Parameters<DeliveryRepository['claim']>
    >(),
    finish: jest.fn<
      ReturnType<DeliveryRepository['finish']>,
      Parameters<DeliveryRepository['finish']>
    >(),
    ready: jest.fn<
      ReturnType<DeliveryRepository['ready']>,
      Parameters<DeliveryRepository['ready']>
    >(),
  };
}
