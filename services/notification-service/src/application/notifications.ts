import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DeliveryRepository,
  deliveryView,
  executionEventSchema,
  publicPayload,
} from '../domain/notification';
import type { ListQuery } from '../domain/notification';
import { InboxRepository } from '../domain/inbox';
import { notificationEventV2Schema } from '../domain/notification-event';

// An actor's own workflow lifecycle actions are not news to them: no inbox row (failures and others' actions stay).
const OWN_ACTION_EVENTS = new Set([
  'workflow.created',
  'workflow.published',
  'workflow.paused',
  'workflow.resumed',
]);

@Injectable()
export class Notifications {
  constructor(
    private readonly repository: DeliveryRepository,
    private readonly inboxRepository: InboxRepository,
  ) {}
  async consume(value: unknown) {
    if (
      value !== null &&
      typeof value === 'object' &&
      'schemaVersion' in value
    ) {
      const event = notificationEventV2Schema.parse(value);
      if (
        OWN_ACTION_EVENTS.has(event.eventType) &&
        event.actorUserId !== null &&
        event.recipientUserIds.every(
          (id) => id.toLowerCase() === event.actorUserId?.toLowerCase(),
        )
      )
        return;
      await this.inboxRepository.ingest(event);
      return;
    }
    const event = executionEventSchema.parse(value);
    await this.repository.ingest(event, publicPayload(event));
  }
  async list(userId: string, query: ListQuery) {
    const rows = await this.repository.list(userId, query);
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(deliveryView),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                id: last.id,
                createdAt: last.createdAt.toISOString(),
              }),
            ).toString('base64url')
          : null,
    };
  }
  async unreadCount(userId: string) {
    return { count: await this.repository.unreadCount(userId) };
  }
  async markRead(userId: string, id: string) {
    const row = await this.repository.markRead(userId, id);
    if (!row) throw new NotFoundException('Notification not found');
    return { item: deliveryView(row) };
  }
  async markAllRead(userId: string) {
    return { updatedCount: await this.repository.markAllRead(userId) };
  }
}
