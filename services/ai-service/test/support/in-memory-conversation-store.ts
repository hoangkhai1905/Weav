import { randomUUID } from 'node:crypto';
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
  type StoredMessage,
  type UsageCounts,
} from '../../src/application/assistant/conversation-store';

const DAY_MS = 86_400_000;

/** Test fake with the same semantics as PrismaConversationStore (the integration test runs the same cases). */
export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<
    string,
    (StoredMessage & { id: string })[]
  >();
  private readonly usage = new Map<string, number>();

  createConversation(input: {
    userId: string;
    workspaceId: string;
    title: string;
  }) {
    try {
      assertValidConversation(input);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    const now = new Date();
    const id = randomUUID();
    this.conversations.set(id, {
      id,
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    this.messages.set(id, []);
    return Promise.resolve({ id });
  }

  getConversation(id: string, userId: string) {
    const c = isUuid(id) ? this.conversations.get(id) : undefined;
    return Promise.resolve(c && c.userId === userId ? { ...c } : null);
  }

  listConversations(
    userId: string,
    workspaceId: string,
    opts: { limit: number; before?: Date; beforeId?: string },
  ) {
    const { before, beforeId } = opts;
    const rows = [...this.conversations.values()]
      .filter(
        (c) =>
          c.userId === userId &&
          c.workspaceId === workspaceId &&
          (!before ||
            c.updatedAt < before ||
            (beforeId !== undefined &&
              c.updatedAt.getTime() === before.getTime() &&
              c.id < beforeId)),
      )
      .sort(
        (a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          (a.id < b.id ? 1 : -1),
      )
      .slice(0, clampListLimit(opts.limit));
    return Promise.resolve(rows.map((c) => ({ ...c })));
  }

  appendMessages(
    conversationId: string,
    userId: string,
    messages: NewMessage[],
  ) {
    try {
      assertValidMessages(messages);
      const c = this.conversations.get(conversationId);
      if (!c || c.userId !== userId) throw new Error('Conversation not found');
      if (messages.length === 0) return Promise.resolve([]);
      const times = batchTimestamps(messages.length);
      const rows = messages.map((m, i) => ({
        ...m,
        id: randomUUID(),
        createdAt: times[i],
      }));
      this.messages.get(conversationId)!.push(...rows);
      c.updatedAt = times[times.length - 1];
      return Promise.resolve(rows.map((r) => r.id));
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  recentMessages(
    conversationId: string,
    userId: string,
    opts: { maxMessages: number; maxChars: number },
  ) {
    const owned = this.conversations.get(conversationId)?.userId === userId;
    const all = owned ? (this.messages.get(conversationId) ?? []) : [];
    const newestFirst = all.slice(-Math.max(1, opts.maxMessages)).reverse();
    return Promise.resolve(
      boundRecent(newestFirst, opts.maxMessages, opts.maxChars).map(
        ({ role, content, createdAt }) => ({ role, content, createdAt }),
      ),
    );
  }

  deleteMessage(conversationId: string, userId: string, messageId: string) {
    const owned = this.conversations.get(conversationId)?.userId === userId;
    const rows = owned ? this.messages.get(conversationId) : undefined;
    const index = rows?.findIndex((m) => m.id === messageId) ?? -1;
    if (!rows || index < 0) return Promise.resolve(false);
    rows.splice(index, 1);
    return Promise.resolve(true);
  }

  async deleteConversation(id: string, userId: string) {
    if (!(await this.getConversation(id, userId))) return false;
    this.conversations.delete(id);
    this.messages.delete(id);
    return true;
  }

  recordUsage(input: { day: string; workspaceId: string; userId: string }) {
    try {
      assertValidUsage(input);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    const key = `${input.day}|${input.workspaceId}|${input.userId}`;
    const userCalls = (this.usage.get(key) ?? 0) + 1;
    this.usage.set(key, userCalls);
    let workspaceCalls = 0;
    for (const [k, v] of this.usage)
      if (k.startsWith(`${input.day}|${input.workspaceId}|`))
        workspaceCalls += v;
    return Promise.resolve<UsageCounts>({ userCalls, workspaceCalls });
  }

  refundUsage(input: { day: string; workspaceId: string; userId: string }) {
    try {
      assertValidUsage(input);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    const key = `${input.day}|${input.workspaceId}|${input.userId}`;
    const calls = this.usage.get(key);
    if (calls !== undefined) this.usage.set(key, Math.max(0, calls - 1));
    return Promise.resolve();
  }

  purge(now: Date, opts: PurgeOptions) {
    const convCutoff = now.getTime() - opts.conversationRetentionDays * DAY_MS;
    let conversations = 0;
    for (const c of [...this.conversations.values()])
      if (c.updatedAt.getTime() < convCutoff) {
        this.conversations.delete(c.id);
        this.messages.delete(c.id);
        conversations++;
      }
    const usageCutoff = new Date(
      now.getTime() - opts.usageRetentionDays * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    let usageRows = 0;
    for (const k of [...this.usage.keys()])
      if (k.slice(0, 10) < usageCutoff) {
        this.usage.delete(k);
        usageRows++;
      }
    return Promise.resolve({ conversations, usageRows });
  }
}
