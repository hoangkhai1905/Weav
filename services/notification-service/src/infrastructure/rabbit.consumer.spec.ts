import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
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
  const ack = jest.fn();
  const sendToQueue = jest.fn<
    void,
    [string, Buffer, object, (err: Error | null) => void]
  >();
  const channel = { ack, sendToQueue } as unknown as ConfirmChannel;
  const message = (value: unknown) =>
    ({
      content: Buffer.from(JSON.stringify(value)),
      fields: { routingKey: 'workflow.completed' },
    }) as ConsumeMessage;
  beforeEach(() => jest.resetAllMocks());
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
  it('leaves transient persistence failure unacked for reconnect redelivery', async () => {
    repo.ingest.mockRejectedValue(new Error('db'));
    await expect(
      consumer.handle(message(testEvent()), channel),
    ).rejects.toThrow();
    expect(ack).not.toHaveBeenCalled();
    expect(sendToQueue).not.toHaveBeenCalled();
  });
  it('confirms sanitized DLQ records before acking malformed messages', async () => {
    let confirm!: (err: Error | null) => void;
    sendToQueue.mockImplementation((_q, _b, _o, cb) => {
      confirm = cb;
    });
    const msg = message({ secret: 'private' });
    const pending = consumer.handle(msg, channel);
    await Promise.resolve();
    expect(ack).not.toHaveBeenCalled();
    expect(sendToQueue.mock.calls[0][1].toString()).not.toContain('private');
    confirm(null);
    await pending;
    expect(ack).toHaveBeenCalledWith(msg);
  });
  it('does not ack if DLQ persistence fails', async () => {
    sendToQueue.mockImplementation((_q, _b, _o, cb) => cb(new Error('broker')));
    await expect(consumer.handle(message({}), channel)).rejects.toThrow(
      'broker',
    );
    expect(ack).not.toHaveBeenCalled();
  });
  it('quarantines an unknown schema version and confirms its DLQ record before ack', async () => {
    let confirm!: (err: Error | null) => void;
    sendToQueue.mockImplementation((_q, _body, _options, callback) => {
      confirm = callback;
    });
    const msg = message({ ...testEvent(), schemaVersion: 3 });

    const pending = consumer.handle(msg, channel);
    await Promise.resolve();

    expect(repo.ingest).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    const dlqBody = sendToQueue.mock.calls[0][1].toString();
    expect(dlqBody).not.toContain('eventId');
    expect(dlqBody).not.toContain('payload');
    confirm(null);
    await pending;
    expect(ack).toHaveBeenCalledWith(msg);
  });
  it('DLQs persisted identity conflicts as terminal and confirms before ack', async () => {
    let confirm!: (err: Error | null) => void;
    sendToQueue.mockImplementation((_q, _body, _options, callback) => {
      confirm = callback;
    });
    repo.ingest.mockRejectedValue(new InboxPersistenceConflictError());
    const msg = message(testEvent());

    const pending = consumer.handle(msg, channel);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(ack).not.toHaveBeenCalled();
    const dlq = JSON.parse(sendToQueue.mock.calls[0][1].toString());
    expect(dlq).toEqual({
      code: 'PERSISTED_EVENT_CONFLICT',
      occurredAt: expect.any(String),
    });
    confirm(null);
    await pending;
    expect(ack).toHaveBeenCalledWith(msg);
  });
});
