import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DeliveryRepository,
  deliveryView,
  executionEventSchema,
  publicPayload,
} from '../domain/notification';
import type { ListQuery } from '../domain/notification';

@Injectable()
export class Notifications {
  constructor(private readonly repository: DeliveryRepository) {}
  async consume(value: unknown) {
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
