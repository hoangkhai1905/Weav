import { connect } from 'amqplib';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { RabbitConsumer } from './rabbit.consumer';
import { Notifications } from '../application/notifications';
import { InboxRepository } from '../domain/inbox';
import { mockRepository, testEvent, testSettings } from '../testing/fixtures';
import { InboxPersistenceConflictError } from './inbox.persistence';

describe('RabbitMQ acknowledgment contract', () => {
  const repo = mockRepository();
  const inboxRepository = {
    ingest: jest.fn().mockResolvedValue(undefined),
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    ready: jest.fn(),
    reconcileLegacy: jest.fn(),
  } as unknown as InboxRepository;
  const service = Reflect.construct(Notifications, [
    repo,
    inboxRepository,
  ]) as Notifications;
  const consumer = new RabbitConsumer(service, testSettings());
  consumer.sleep = jest.fn().mockResolvedValue(undefined);
  const ack = jest.fn();
  const nack = jest.fn();
  const reject = jest.fn();
  const sendToQueue = jest.fn();
  const channel = {
    ack,
    nack,
    reject,
    sendToQueue,
  } as unknown as ConfirmChannel;
  const message = (value: unknown, deliveryCount = 0) =>
    ({
      content: Buffer.from(JSON.stringify(value)),
      fields: { routingKey: 'workflow.completed' },
      properties: {
        headers: deliveryCount ? { 'x-delivery-count': deliveryCount } : {},
      },
    }) as unknown as ConsumeMessage;
  beforeEach(() => {
    jest.resetAllMocks();
    (consumer.sleep as jest.Mock).mockResolvedValue(undefined);
  });
  it('acks only after the durable insert finishes', async () => {
    let resolve!: () => void;
    repo.ingest.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const msg = message(testEvent());
    const pending = consumer.handle(msg, channel);
    expect(ack).not.toHaveBeenCalled();
    resolve();
    await pending;
    expect(ack).toHaveBeenCalledWith(msg);
  });
  it('requeues a transient failure without acking, closing, or dead-lettering', async () => {
    repo.ingest.mockRejectedValue(new Error('db'));
    const msg = message(testEvent(), 3);
    await consumer.handle(msg, channel);
    expect(consumer.sleep).toHaveBeenCalledWith(4000);
    expect(reject).toHaveBeenCalledWith(msg, true);
    expect(nack).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    expect(sendToQueue).not.toHaveBeenCalled();
  });
  it('caps the transient backoff and uses a fixed pause on the legacy queue', async () => {
    repo.ingest.mockRejectedValue(new Error('db'));
    await consumer.handle(message(testEvent(), 9), channel);
    expect(consumer.sleep).toHaveBeenLastCalledWith(30000);
    await consumer.handle(message(testEvent()), channel, true);
    expect(consumer.sleep).toHaveBeenLastCalledWith(5000);
  });
  it.each([
    ['malformed JSON', () => ({ content: Buffer.from('{nope') })],
    ['schema error', () => message({ secret: 'private' })],
    [
      'unknown schema version',
      () => message({ ...testEvent(), schemaVersion: 3 }),
    ],
    [
      'routing key mismatch',
      () => ({
        ...message(testEvent()),
        fields: { routingKey: 'workflow.failed' },
      }),
    ],
  ])(
    'dead-letters %s via nack without requeue and never publishes a copy',
    async (_n, build) => {
      const msg = {
        properties: { headers: {} },
        fields: { routingKey: 'workflow.completed' },
        ...build(),
      } as unknown as ConsumeMessage;
      await consumer.handle(msg, channel);
      expect(nack).toHaveBeenCalledWith(msg, false, false);
      expect(ack).not.toHaveBeenCalled();
      expect(sendToQueue).not.toHaveBeenCalled();
      expect(repo.ingest).not.toHaveBeenCalled();
    },
  );
  it('dead-letters persisted identity conflicts and permanent data errors', async () => {
    for (const error of [
      new InboxPersistenceConflictError(),
      Object.assign(new Error('x'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2000',
      }),
      Object.assign(new Error('x'), { name: 'PrismaClientValidationError' }),
      new RangeError('Invalid time value'),
    ]) {
      nack.mockClear();
      repo.ingest.mockRejectedValue(error);
      const msg = message(testEvent());
      await consumer.handle(msg, channel);
      expect(nack).toHaveBeenCalledWith(msg, false, false);
    }
  });
  it('treats other Prisma errors (connectivity) as transient', async () => {
    repo.ingest.mockRejectedValue(
      Object.assign(new Error('x'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P1001',
      }),
    );
    const msg = message(testEvent());
    await consumer.handle(msg, channel);
    expect(reject).toHaveBeenCalledWith(msg, true);
    expect(nack).not.toHaveBeenCalled();
  });
});

describe('RabbitMQ topology', () => {
  it('declares a quorum queue with delivery limit and DLX, binds it, unbinds and drains the old one', async () => {
    const calls: Record<string, unknown[][]> = {};
    const rec = (name: string) =>
      jest.fn((...args: unknown[]) => {
        (calls[name] ??= []).push(args);
        return Promise.resolve({});
      });
    const channel = {
      on: jest.fn(),
      assertExchange: rec('assertExchange'),
      assertQueue: rec('assertQueue'),
      bindQueue: rec('bindQueue'),
      unbindQueue: rec('unbindQueue'),
      prefetch: rec('prefetch'),
      consume: rec('consume'),
    };
    const connection = {
      on: jest.fn(),
      createConfirmChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (connect as jest.Mock).mockResolvedValue(connection);
    const settings = testSettings();
    const consumer = new RabbitConsumer({} as Notifications, settings);
    await (consumer as unknown as { open(): Promise<void> }).open();
    const queues = calls.assertQueue.map((c) => c[0]);
    expect(queues).toEqual([
      settings.NOTIFICATION_DLQ,
      `${settings.NOTIFICATION_QUEUE}.v2`,
      settings.NOTIFICATION_QUEUE,
    ]);
    expect(calls.assertQueue[1][1]).toMatchObject({
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
        'x-delivery-limit': 10,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': settings.NOTIFICATION_DLQ,
      },
    });
    expect(
      calls.bindQueue.every(
        (c) => c[0] === `${settings.NOTIFICATION_QUEUE}.v2`,
      ),
    ).toBe(true);
    expect(calls.bindQueue.length).toBeGreaterThan(0);
    expect(
      calls.unbindQueue.every((c) => c[0] === settings.NOTIFICATION_QUEUE),
    ).toBe(true);
    expect(calls.unbindQueue).toHaveLength(calls.bindQueue.length);
    expect(calls.consume.map((c) => c[0])).toEqual([
      `${settings.NOTIFICATION_QUEUE}.v2`,
      settings.NOTIFICATION_QUEUE,
    ]);
    expect(consumer.isReady).toBe(true);
  });
});
