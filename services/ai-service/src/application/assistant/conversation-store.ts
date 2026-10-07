/** Persistence port for the assistant: per-user chat history and daily usage counters. */

export type MessageRole = 'user' | 'assistant';

export interface ConversationRecord {
  id: string;
  userId: string;
  workspaceId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewMessage {
  role: MessageRole;
  content: string;
}

export interface StoredMessage extends NewMessage {
  createdAt: Date;
}

export interface UsageCounts {
  userCalls: number;
  workspaceCalls: number;
}

export interface PurgeOptions {
  conversationRetentionDays: number;
  usageRetentionDays: number;
}

export interface PurgeResult {
  conversations: number;
  usageRows: number;
}

export interface ConversationStore {
  /** Title is the trimmed first user message (see conversationTitle). */
  createConversation(input: {
    userId: string;
    workspaceId: string;
    title: string;
  }): Promise<{ id: string }>;
  /** Owner check: null when missing or owned by someone else. */
  getConversation(
    id: string,
    userId: string,
  ): Promise<ConversationRecord | null>;
  /** Newest first (updated_at); `limit` is clamped to 1..50. */
  listConversations(
    userId: string,
    workspaceId: string,
    opts: { limit: number; before?: Date },
  ): Promise<ConversationRecord[]>;
  /** One transaction; also bumps updated_at. Throws (writing nothing) on an unknown or foreign conversation. */
  appendMessages(
    conversationId: string,
    userId: string,
    messages: NewMessage[],
  ): Promise<void>;
  /** Oldest-first tail within both bounds, always keeping the latest; [] for a foreign conversation. */
  recentMessages(
    conversationId: string,
    userId: string,
    opts: { maxMessages: number; maxChars: number },
  ): Promise<StoredMessage[]>;
  deleteConversation(id: string, userId: string): Promise<boolean>;
  /** Atomic increment; `day` is a UTC calendar day, YYYY-MM-DD. */
  recordUsage(input: {
    day: string;
    workspaceId: string;
    userId: string;
  }): Promise<UsageCounts>;
  /** Conversations by updated_at, usage rows by day. */
  purge(now: Date, opts: PurgeOptions): Promise<PurgeResult>;
}

export const MAX_MESSAGE_CHARS = 16_000;
export const MAX_TITLE_CODE_POINTS = 80;
export const MAX_TITLE_STORED = 120;
export const MAX_LIST_LIMIT = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lookups with a malformed id are plain misses, not database errors. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function conversationTitle(firstUserMessage: string): string {
  const title = [...firstUserMessage.trim()]
    .slice(0, MAX_TITLE_CODE_POINTS)
    .join('');
  return title || 'New conversation';
}

export function clampListLimit(limit: number): number {
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Mirrors the SQL CHECKs so the fake and the real store reject the same input. */
export function assertValidMessages(messages: NewMessage[]): void {
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant')
      throw new Error('Invalid message role');
    if (m.content.length > MAX_MESSAGE_CHARS)
      throw new Error('Message content too long');
    // Postgres text cannot hold NUL.
    if (m.content.includes('\u0000'))
      throw new Error('Message content contains NUL');
  }
}

export function assertValidConversation(input: {
  userId: string;
  workspaceId: string;
  title: string;
}): void {
  if (!isUuid(input.userId)) throw new Error('Invalid userId');
  if (!isUuid(input.workspaceId)) throw new Error('Invalid workspaceId');
  if ([...input.title].length > MAX_TITLE_STORED)
    throw new Error('Title too long');
  if (input.title.includes('\u0000')) throw new Error('Title contains NUL');
}

export function assertValidUsage(input: {
  day: string;
  workspaceId: string;
  userId: string;
}): void {
  if (!isUuid(input.userId)) throw new Error('Invalid userId');
  if (!isUuid(input.workspaceId)) throw new Error('Invalid workspaceId');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
    Number.isNaN(Date.parse(input.day)) ||
    new Date(input.day).toISOString().slice(0, 10) !== input.day
  )
    throw new Error('Invalid day');
}

/**
 * `newestFirst` is the latest messages, newest first. Keeps the newest ones whose total length
 * fits `maxChars` (the latest message is kept even when it alone exceeds it), returned oldest first.
 */
export function boundRecent<T extends { content: string }>(
  newestFirst: T[],
  maxMessages: number,
  maxChars: number,
): T[] {
  const kept: T[] = [];
  let chars = 0;
  for (const m of newestFirst.slice(0, Math.max(1, maxMessages))) {
    if (kept.length > 0 && chars + m.content.length > maxChars) break;
    kept.push(m);
    chars += m.content.length;
  }
  return kept.reverse();
}

/** Message timestamps inside one batch are offset by 1 ms so ordering by created_at is stable. */
export function batchTimestamps(count: number, base = Date.now()): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(base + i));
}
