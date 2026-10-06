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

export class PrismaConversationStore implements ConversationStore {
  private readonly client: PrismaClient;

  constructor(db: AiDatabaseOptions) {
    this.client = new PrismaClient({
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
    opts: { limit: number; before?: Date },
  ): Promise<ConversationRecord[]> {
    return this.client.conversation.findMany({
      where: {
        userId,
        workspaceId,
        ...(opts.before ? { updatedAt: { lt: opts.before } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: clampListLimit(opts.limit),
    });
  }

  async appendMessages(
    conversationId: string,
    userId: string,
    messages: NewMessage[],
  ): Promise<void> {
    assertValidMessages(messages);
    if (!isUuid(conversationId)) throw new Error('Conversation not found');
    const times = batchTimestamps(Math.max(1, messages.length));
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

  // ponytail: one unbounded delete under the 10 s statement_timeout; batch the deletes if a backlog ever builds up.
  async purge(now: Date, opts: PurgeOptions): Promise<PurgeResult> {
    const conversations = await this.client.conversation.deleteMany({
      where: {
        updatedAt: {
          lt: new Date(now.getTime() - opts.conversationRetentionDays * DAY_MS),
        },
      },
    });
    const cutoff = new Date(now.getTime() - opts.usageRetentionDays * DAY_MS);
    const usage = await this.client.assistantUsage.deleteMany({
      where: { day: { lt: new Date(cutoff.toISOString().slice(0, 10)) } },
    });
    return { conversations: conversations.count, usageRows: usage.count };
  }
}
