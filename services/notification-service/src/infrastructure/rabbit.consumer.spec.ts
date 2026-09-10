import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { RabbitConsumer } from './rabbit.consumer';
import { Notifications } from '../application/notifications';
import { mockRepository, testEvent, testSettings } from '../testing/fixtures';

describe('RabbitMQ acknowledgment contract', () => {
  const repo = mockRepository();
  const service = new Notifications(repo);
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
});
