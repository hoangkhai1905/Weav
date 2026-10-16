/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- mocked Prisma client */
import { Prisma } from '../../node_modules/.prisma/notification';
import { PrismaDeliveryRepository } from './prisma.repository';
import { testDelivery, testEvent, testSettings } from '../testing/fixtures';

type Sql = [TemplateStringsArray, ...unknown[]];
const text = (call: Sql) => call[0].join('?').replace(/\s+/g, ' ');

function setup(options: { claimed?: { id: string }[]; locked?: boolean } = {}) {
  const row = testDelivery();
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(3),
    $queryRaw: jest.fn((...args: Sql) =>
      Promise.resolve(
        text(args).includes('pg_try_advisory_xact_lock')
          ? [{ locked: options.locked ?? true }]
          : (options.claimed ?? [{ id: row.id }]),
      ),
    ),
    notificationDelivery: { findUnique: jest.fn().mockResolvedValue(row) },
  };
  const client = {
    $transaction: jest.fn((fn: any) => fn(tx)),
    notificationDelivery: { updateMany: jest.fn().mockResolvedValue({}) },
  };
  const repo = new PrismaDeliveryRepository(testSettings());
  (repo as unknown as { client: unknown }).client = client;
  return { repo, tx, client, row };
}

describe('PrismaDeliveryRepository.claim', () => {
  it('expires exhausted leases, then claims one due row inside one transaction', async () => {
    const { repo, tx, client, row } = setup();
    const claimed = await repo.claim(5, 60000);
    expect(claimed).toBe(row);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    const expire = text(tx.$executeRaw.mock.calls[0] as Sql);
    expect(expire).toContain("status='SENDING'");
    expect(expire).toContain('ATTEMPTS_EXHAUSTED');
    const claim = text(tx.$queryRaw.mock.calls[0]);
    expect(claim).toContain('FOR UPDATE SKIP LOCKED LIMIT 1');
    expect(claim).toContain("SET status='SENDING'");
    // lease and max attempts are bound parameters, never interpolated into the SQL text
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([60000, 5]);
    expect(tx.notificationDelivery.findUnique).toHaveBeenCalledWith({
      where: { id: row.id },
    });
  });
  it('returns null and reads nothing when no row is due', async () => {
    const { repo, tx } = setup({ claimed: [] });
    await expect(repo.claim(5, 60000)).resolves.toBeNull();
    expect(tx.notificationDelivery.findUnique).not.toHaveBeenCalled();
  });
});

describe('PrismaDeliveryRepository.finish', () => {
  it('fences the update on SENDING status and the claimed updated_at', async () => {
    const { repo, client, row } = setup();
    await repo.finish(row, {
      status: 'SENT',
      scheduledAt: null,
      sentAt: new Date(),
      lastError: null,
    });
    const arg = client.notificationDelivery.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      id: row.id,
      status: 'SENDING',
      updatedAt: row.updatedAt,
    });
    expect(arg.data).toMatchObject({ status: 'SENT', scheduledAt: null });
    expect(arg.data.lastError).toBe(Prisma.DbNull);
  });
  it('passes a structured error and payload through unchanged', async () => {
    const { repo, client, row } = setup();
    const lastError = { code: 'TIMEOUT', retryable: true };
    await repo.finish(row, {
      status: 'FAILED',
      scheduledAt: new Date(),
      lastError,
      payload: { a: 1 },
    });
    const data = client.notificationDelivery.updateMany.mock.calls[0][0].data;
    expect(data.lastError).toEqual(lastError);
    expect(data.payload).toEqual({ a: 1 });
  });
  it('leaves lastError untouched when the patch omits it', async () => {
    const { repo, client, row } = setup();
    await repo.finish(row, { status: 'PENDING', scheduledAt: null });
    const data = client.notificationDelivery.updateMany.mock.calls[0][0].data;
    expect(data.lastError).toBeUndefined();
  });
});

describe('PrismaDeliveryRepository retention purge', () => {
  it('takes the advisory lock first and deletes only terminal, expired deliveries', async () => {
    const { repo, tx } = setup();
    await expect(repo.purgeDeliveries(90, 1000)).resolves.toBe(3);
    expect(text(tx.$queryRaw.mock.calls[0])).toContain(
      'pg_try_advisory_xact_lock',
    );
    const sql = text(tx.$executeRaw.mock.calls[0] as Sql);
    expect(sql).toContain('DELETE FROM notification.notification_deliveries');
    expect(sql).toContain(
      "status='SENT' OR (status='FAILED' AND scheduled_at IS NULL)",
    );
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).not.toContain("'PENDING'");
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([90, 1000]);
  });
  it('deletes only inbox rows without remaining deliveries', async () => {
    const { repo, tx } = setup();
    await expect(repo.purgeInbox(30, 500)).resolves.toBe(3);
    const sql = text(tx.$executeRaw.mock.calls[0] as Sql);
    expect(sql).toContain('DELETE FROM notification.notification_inbox');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('d.inbox_id = i.id AND d.user_id = i.user_id');
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([30, 500]);
  });
  it.each(['purgeDeliveries', 'purgeInbox'] as const)(
    '%s returns null and deletes nothing when the lock is held elsewhere',
    async (method) => {
      const { repo, tx } = setup({ locked: false });
      await expect(repo[method](90, 1000)).resolves.toBeNull();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    },
  );
});

describe('PrismaDeliveryRepository.nextDueInMs', () => {
  it('reads one MIN row on the DB clock with bound parameters', async () => {
    const { repo, client } = setup();
    const queryRaw = jest.fn().mockResolvedValue([{ ms: 1234.5 }]);
    (client as unknown as Record<string, unknown>).$queryRaw = queryRaw;
    await expect(repo.nextDueInMs(5, 60000)).resolves.toBe(1234.5);
    const sql = text(queryRaw.mock.calls[0] as Sql);
    expect(sql).toContain('MIN(scheduled_at)');
    expect(sql).toContain("status='SENDING'");
    expect(queryRaw.mock.calls[0].slice(1)).toEqual([5, 60000]);
  });
  it('returns null when nothing is pending', async () => {
    const { repo, client } = setup();
    (client as unknown as Record<string, unknown>).$queryRaw = jest
      .fn()
      .mockResolvedValue([{ ms: null }]);
    await expect(repo.nextDueInMs(5, 60000)).resolves.toBeNull();
  });
});

describe('PrismaDeliveryRepository.ingest', () => {
  it('waits for a pooled connection long enough for a consumer burst', async () => {
    const { repo, client } = setup();
    client.$transaction.mockResolvedValue(undefined);
    await repo.ingest(testEvent(), {});
    expect(client.$transaction.mock.calls[0][1]).toEqual({
      maxWait: 10000,
      timeout: 30000,
    });
  });
});
