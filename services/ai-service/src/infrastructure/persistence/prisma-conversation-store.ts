import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../node_modules/.prisma/ai';
import {
  assertValidConversation,
  assertValidMessages,
  assertValidUsage,
  batchTimestamps,
  boundRecent,
  clampListLimit,
  isUuid,
  type ConversationRecord,
  type ConversationStore,
  type NewMessage,
  type PurgeOptions,
  type PurgeResult,
  type StoredMessage,
  type UsageCounts,
} from '../../application/assistant/conversation-store';

export interface AiDatabaseOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
}

const DAY_MS = 86_400_000;
/** Retention deletes run in slices this big so one statement stays far below the 10 s statement_timeout. */
export const PURGE_BATCH_SIZE = 500;

export class PrismaConversationStore implements ConversationStore {
  private readonly client: PrismaClient;

  /** `client` is for tests; production builds its own. */
  constructor(db: AiDatabaseOptions, client?: PrismaClient) {
    this.client =
      client ??
      new PrismaClient({
        adapter: new PrismaPg(
          {
            host: db.host,
            port: db.port,
            database: db.database,
            user: db.user,
            password: db.password,
            ssl: db.ssl ? { rejectUnauthorized: true } : false,
            max: 3,
            connectionTimeoutMillis: 5000,
            statement_timeout: 10000,
          },
          { schema: 'ai' },
        ),
      });
  }

  close(): Promise<void> {
    return this.client.$disconnect();
  }

  async createConversation(input: {
    userId: string;
    workspaceId: string;
    title: string;
  }) {
    assertValidConversation(input);
    const row = await this.client.conversation.create({
      data: input,
      select: { id: true },
    });
    return { id: row.id };
  }

  async getConversation(
    id: string,
    userId: string,
  ): Promise<ConversationRecord | null> {
    if (!isUuid(id)) return null;
    return this.client.conversation.findFirst({ where: { id, userId } });
  }

  listConversations(
    userId: string,
    workspaceId: string,
    opts: { limit: number; before?: Date; beforeId?: string },
  ): Promise<ConversationRecord[]> {
    const { before, beforeId } = opts;
    let cursor = {};
    if (before && beforeId)
      // Keyset on (updated_at, id), the same order as below.
      cursor = {
        OR: [
          { updatedAt: { lt: before } },
          { updatedAt: before, id: { lt: beforeId } },
        ],
      };
    else if (before) cursor = { updatedAt: { lt: before } };
    return this.client.conversation.findMany({
      where: { userId, workspaceId, ...cursor },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: clampListLimit(opts.limit),
    });
  }

  async appendMessages(
    conversationId: string,
    userId: string,
    messages: NewMessage[],
  ): Promise<string[]> {
    assertValidMessages(messages);
    if (!isUuid(conversationId)) throw new Error('Conversation not found');
    const times = batchTimestamps(Math.max(1, messages.length));
    // Ids are made here (createMany returns none) so the caller can undo exactly this write.
    const ids = messages.map(() => randomUUID());
    await this.client.$transaction(async (tx) => {
      // Ownership is checked inside the transaction, so a foreign conversation is never written to.
      const owned = await tx.conversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true },
      });
      if (!owned) throw new Error('Conversation not found');
      if (messages.length === 0) return;
      await tx.message.createMany({
        data: messages.map((m, i) => ({
          id: ids[i],
          conversationId,
          role: m.role,
          content: m.content,
          createdAt: times[i],
        })),
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: times[messages.length - 1] },
      });
    });
    return ids;
  }

  async deleteMessage(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<boolean> {
    if (!isUuid(conversationId) || !isUuid(messageId)) return false;
    const { count } = await this.client.message.deleteMany({
      where: { id: messageId, conversationId, conversation: { userId } },
    });
    return count > 0;
  }

  async recentMessages(
    conversationId: string,
    userId: string,
    opts: { maxMessages: number; maxChars: number },
  ): Promise<StoredMessage[]> {
    if (!isUuid(conversationId)) return [];
    const rows = await this.client.message.findMany({
      where: { conversationId, conversation: { userId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.max(1, opts.maxMessages),
      select: { role: true, content: true, createdAt: true },
    });
    return boundRecent(
      rows.map((r) => ({ ...r, role: r.role as StoredMessage['role'] })),
      opts.maxMessages,
      opts.maxChars,
    );
  }

  async deleteConversation(id: string, userId: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await this.client.conversation.deleteMany({
      where: { id, userId },
    });
    return count > 0;
  }

  async recordUsage(input: {
    day: string;
    workspaceId: string;
    userId: string;
  }): Promise<UsageCounts> {
    assertValidUsage(input);
    const { day, workspaceId, userId } = input;
    const [mine] = await this.client.$queryRaw<{ calls: number }[]>`
      INSERT INTO ai.assistant_usage (day, workspace_id, user_id, calls)
      VALUES (${day}::date, ${workspaceId}::uuid, ${userId}::uuid, 1)
      ON CONFLICT (day, workspace_id, user_id)
      DO UPDATE SET calls = ai.assistant_usage.calls + 1
      RETURNING calls`;
    const [total] = await this.client.$queryRaw<{ calls: number }[]>`
      SELECT COALESCE(SUM(calls), 0)::int AS calls FROM ai.assistant_usage
      WHERE day = ${day}::date AND workspace_id = ${workspaceId}::uuid`;
    return { userCalls: mine.calls, workspaceCalls: total.calls };
  }

  async refundUsage(input: {
    day: string;
    workspaceId: string;
    userId: string;
  }): Promise<void> {
    assertValidUsage(input);
    const { day, workspaceId, userId } = input;
    await this.client.$executeRaw`
      UPDATE ai.assistant_usage SET calls = GREATEST(calls - 1, 0)
      WHERE day = ${day}::date AND workspace_id = ${workspaceId}::uuid
        AND user_id = ${userId}::uuid`;
  }

  /** Deletes in slices of PURGE_BATCH_SIZE (select ids, delete those ids) until a slice comes back short. */
  async purge(now: Date, opts: PurgeOptions): Promise<PurgeResult> {
    const conversationCutoff = new Date(
      now.getTime() - opts.conversationRetentionDays * DAY_MS,
    );
    let conversations = 0;
    for (;;) {
      const rows = await this.client.conversation.findMany({
        where: { updatedAt: { lt: conversationCutoff } },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const { count } = await this.client.conversation.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      conversations += count;
      // A short slice is the last one; nothing deleted means someone else got there first.
      if (rows.length < PURGE_BATCH_SIZE || count === 0) break;
    }
    const cutoff = new Date(now.getTime() - opts.usageRetentionDays * DAY_MS);
    const usageCutoff = new Date(cutoff.toISOString().slice(0, 10));
    let usageRows = 0;
    for (;;) {
      // The usage table has a composite key (day, workspace, user) and no id column.
      const rows = await this.client.assistantUsage.findMany({
        where: { day: { lt: usageCutoff } },
        select: { day: true, workspaceId: true, userId: true },
        take: PURGE_BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const { count } = await this.client.assistantUsage.deleteMany({
        where: { OR: rows },
      });
      usageRows += count;
      if (rows.length < PURGE_BATCH_SIZE || count === 0) break;
    }
    return { conversations, usageRows };
  }
}
