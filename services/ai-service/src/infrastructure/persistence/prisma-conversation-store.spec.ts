import type { PrismaClient } from '../../../node_modules/.prisma/ai';
import {
  PrismaConversationStore,
  PURGE_BATCH_SIZE,
} from './prisma-conversation-store';

const db = { host: 'h', port: 1, database: 'd', user: 'u', ssl: false };
const opts = { conversationRetentionDays: 30, usageRetentionDays: 90 };
const NOW = new Date('2026-10-12T00:00:00.000Z');

const conversationRows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `c-${from + i}` }));
const usageRows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    day: new Date('2020-01-01'),
    workspaceId: `w-${from + i}`,
    userId: `u-${from + i}`,
  }));

function setup(
  conversations: { id: string }[][],
  usage: ReturnType<typeof usageRows>[] = [],
) {
  const queue = <T>(batches: T[][]) => {
    const fn = jest.fn();
    for (const batch of batches) fn.mockResolvedValueOnce(batch);
    return fn.mockResolvedValue([]);
  };
  const client = {
    conversation: {
      findMany: queue(conversations),
      deleteMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve({ count: where.id.in.length }),
      ),
    },
    assistantUsage: {
      findMany: queue(usage),
      deleteMany: jest.fn(({ where }: { where: { OR: unknown[] } }) =>
        Promise.resolve({ count: where.OR.length }),
      ),
    },
  };
  const store = new PrismaConversationStore(
    db,
    client as unknown as PrismaClient,
  );
  return { store, client };
}

describe('PrismaConversationStore.purge (batched)', () => {
  it('deletes the selected ids slice by slice until a short slice', async () => {
    const { store, client } = setup([
      conversationRows(PURGE_BATCH_SIZE),
      conversationRows(PURGE_BATCH_SIZE, 500),
      conversationRows(120, 1000),
    ]);
    const result = await store.purge(NOW, opts);
    expect(result).toEqual({ conversations: 1120, usageRows: 0 });
    expect(client.conversation.findMany).toHaveBeenCalledTimes(3);
    for (const [arg] of client.conversation.findMany.mock.calls as [
      { take: number; select: unknown; where: unknown },
    ][])
      expect(arg).toMatchObject({
        take: 500,
        select: { id: true },
        where: {
          updatedAt: { lt: new Date('2026-09-12T00:00:00.000Z') },
        },
      });
    const deleted = (
      client.conversation.deleteMany.mock.calls as [
        { where: { id: { in: string[] } } },
      ][]
    ).map(([arg]) => arg.where.id.in);
    expect(deleted.map((ids) => ids.length)).toEqual([500, 500, 120]);
    expect(deleted[0][0]).toBe('c-0');
    expect(deleted[2][119]).toBe('c-1119');
  });

  it('runs one more select when the last slice is exactly full', async () => {
    const { store, client } = setup([conversationRows(PURGE_BATCH_SIZE)]);
    expect((await store.purge(NOW, opts)).conversations).toBe(500);
    expect(client.conversation.findMany).toHaveBeenCalledTimes(2);
    expect(client.conversation.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing to purge', async () => {
    const { store, client } = setup([]);
    expect(await store.purge(NOW, opts)).toEqual({
      conversations: 0,
      usageRows: 0,
    });
    expect(client.conversation.deleteMany).not.toHaveBeenCalled();
    expect(client.assistantUsage.deleteMany).not.toHaveBeenCalled();
  });

  it('stops instead of spinning when a full slice deletes nothing', async () => {
    const { store, client } = setup([
      conversationRows(PURGE_BATCH_SIZE),
      conversationRows(PURGE_BATCH_SIZE),
    ]);
    client.conversation.deleteMany.mockResolvedValue({ count: 0 });
    expect((await store.purge(NOW, opts)).conversations).toBe(0);
    expect(client.conversation.findMany).toHaveBeenCalledTimes(1);
  });

  it('batches the usage rows by their composite key too', async () => {
    const { store, client } = setup(
      [],
      [usageRows(PURGE_BATCH_SIZE), usageRows(7, 500)],
    );
    const result = await store.purge(NOW, opts);
    expect(result.usageRows).toBe(507);
    expect(client.assistantUsage.findMany).toHaveBeenCalledTimes(2);
    const first = (
      client.assistantUsage.deleteMany.mock.calls as [
        { where: { OR: unknown[] } },
      ][]
    )[0][0];
    expect(first.where.OR).toHaveLength(500);
    expect(client.assistantUsage.findMany).toHaveBeenNthCalledWith(1, {
      take: 500,
      select: { day: true, workspaceId: true, userId: true },
      where: { day: { lt: new Date('2026-07-14') } },
    });
  });

  it('propagates a database failure to the caller (the scheduler logs it)', async () => {
    const { store, client } = setup([conversationRows(3)]);
    client.conversation.deleteMany.mockRejectedValue(new Error('timeout'));
    await expect(store.purge(NOW, opts)).rejects.toThrow('timeout');
  });
});
