import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type {
  NotificationLocale,
  NotificationTarget,
} from '../domain/notification-catalog';
import { InboxRepository } from '../domain/inbox';
import type { InboxItem, InboxQuery } from '../domain/inbox';

const categorySchema = z.enum([
  'WORKFLOW',
  'WORKSPACE',
  'CONNECTION',
  'SECURITY',
]);
const severitySchema = z.enum(['INFO', 'SUCCESS', 'WARNING', 'ERROR']);
const targetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('WORKFLOW'),
      workspaceId: z.uuid(),
      workflowId: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('EXECUTION'),
      workspaceId: z.uuid(),
      executionId: z.uuid(),
    })
    .strict(),
  z.object({ kind: z.literal('WORKSPACE'), workspaceId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('CONNECTION'),
      workspaceId: z.uuid(),
      connectionId: z.uuid(),
    })
    .strict(),
  z.object({ kind: z.literal('SECURITY_SETTINGS') }).strict(),
  z.object({ kind: z.literal('NONE') }).strict(),
]);

type InboxView = {
  id: string;
  eventType: string;
  category: InboxItem['category'];
  severity: InboxItem['severity'];
  title: string;
  message: string;
  target: NotificationTarget;
  workspaceId: string | null;
  executionId: string | null;
  occurredAt: string;
  createdAt: string;
  readAt: string | null;
};

@Injectable()
export class InboxNotifications {
  constructor(private readonly repository: InboxRepository) {}

  async list(userId: string, query: InboxQuery, locale: NotificationLocale) {
    const rows = await this.repository.list(userId, query);
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map((item) => this.view(item, locale)),
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

  async markRead(userId: string, id: string, locale: NotificationLocale) {
    const item = await this.repository.markRead(userId, id);
    if (!item) throw new NotFoundException('Notification not found');
    return { item: this.view(item, locale) };
  }

  async markAllRead(userId: string) {
    return { updatedCount: await this.repository.markAllRead(userId) };
  }

  private view(item: InboxItem, locale: NotificationLocale): InboxView {
    const content = item.content[locale] as unknown as Record<string, unknown>;
    const title = z.string().min(1).max(500).parse(content.title);
    const message = z.string().min(1).max(2000).parse(content.message);
    const target = targetSchema.parse(content.target);
    const category = categorySchema.parse(item.category);
    const severity = severitySchema.parse(item.severity);
    return {
      id: item.id,
      eventType: item.eventType,
      category,
      severity,
      title,
      message,
      target,
      workspaceId: item.workspaceId,
      executionId: item.executionId,
      occurredAt: item.occurredAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
      readAt: item.readAt?.toISOString() ?? null,
    };
  }
}
