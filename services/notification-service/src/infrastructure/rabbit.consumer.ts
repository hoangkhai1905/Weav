import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { connect } from 'amqplib';
import type { ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { ZodError } from 'zod';
import { Notifications } from '../application/notifications';
import { SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';
import { notificationEventTypes } from '../domain/notification-event';
import { InboxPersistenceConflictError } from './inbox.persistence';

// Errors a retry cannot fix: bad payload, persisted-event conflict, rejected data values.
const PERMANENT_PRISMA_CODES = new Set([
  'P2000',
  'P2005',
  'P2006',
  'P2007',
  'P2020',
]);
function isPermanent(error: unknown) {
  if (
    error instanceof SyntaxError ||
    error instanceof ZodError ||
    error instanceof RangeError ||
    error instanceof InboxPersistenceConflictError
  )
    return true;
  const e = error as { name?: string; code?: string } | null;
  return (
    e?.name === 'PrismaClientValidationError' ||
    (e?.name === 'PrismaClientKnownRequestError' &&
      PERMANENT_PRISMA_CODES.has(e.code ?? ''))
  );
}

@Injectable()
export class RabbitConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitConsumer.name);
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private retry = 0;
  private connecting?: Promise<void>;
  isReady = false;
  constructor(
    private readonly notifications: Notifications,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}
  onModuleInit() {
    this.launch();
  }
  private launch() {
    this.connecting = this.open().catch(() => {
      this.logger.warn({ event: 'notification_broker_unavailable' });
      this.reconnect();
    });
  }
  private reconnect() {
    this.isReady = false;
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.launch();
      },
      Math.min(30000, 1000 * 2 ** Math.min(this.retry++, 5)),
    );
  }
  private async open() {
    const s = this.settings;
    const connection = await connect(
      {
        protocol: s.RABBITMQ_TLS ? 'amqps' : 'amqp',
        hostname: s.RABBITMQ_HOST,
        port: s.RABBITMQ_PORT,
        username: s.RABBITMQ_USERNAME,
        password: s.RABBITMQ_PASSWORD,
        vhost: s.RABBITMQ_VHOST,
        heartbeat: 15,
      },
      { timeout: 5000 },
    );
    this.connection = connection;
    connection.on('error', () => {
      this.isReady = false;
    });
    connection.on('close', () => this.reconnect());
    try {
      const channel = await connection.createConfirmChannel();
      this.channel = channel;
      channel.on('error', () => {
        this.isReady = false;
      });
      channel.on('close', () => {
        this.isReady = false;
        void connection.close().catch(() => undefined);
      });
      await channel.assertExchange(s.NOTIFICATION_EXCHANGE, 'topic', {
        durable: true,
      });
      await channel.assertQueue(s.NOTIFICATION_DLQ, { durable: true });
      // Quorum queue with a delivery limit: a message that keeps failing is dead-lettered
      // (original body + x-death headers) instead of blocking the queue forever.
      const queue = this.queueName();
      await channel.assertQueue(queue, {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-delivery-limit': s.NOTIFICATION_DELIVERY_LIMIT,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': s.NOTIFICATION_DLQ,
        },
      });
      for (const key of notificationEventTypes)
        await channel.bindQueue(queue, s.NOTIFICATION_EXCHANGE, key);
      await channel.prefetch(1);
      const listen = (name: string, legacy: boolean) =>
        channel.consume(
          name,
          (message) => {
            if (!message) {
              void connection.close().catch(() => undefined);
              return;
            }
            void this.handle(message, channel, legacy).catch(() => {
              void connection.close().catch(() => undefined);
            });
          },
          { noAck: false },
        );
      await listen(queue, false);
      if (s.NOTIFICATION_LEGACY_DRAIN) {
        // Pre-quorum classic queue (arguments cannot change in place). Stop new routing into it
        // and drain what is left with the same handler; an operator deletes it once empty.
        await channel.assertQueue(s.NOTIFICATION_QUEUE, {
          durable: true,
          arguments: {
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': s.NOTIFICATION_DLQ,
          },
        });
        for (const key of notificationEventTypes)
          await channel.unbindQueue(
            s.NOTIFICATION_QUEUE,
            s.NOTIFICATION_EXCHANGE,
            key,
          );
        await listen(s.NOTIFICATION_QUEUE, true);
      }
      this.retry = 0;
      this.isReady = true;
      if (this.stopped) await connection.close();
    } catch {
      await connection.close().catch(() => undefined);
      throw new Error('Broker setup failed');
    }
  }
  private queueName() {
    return (
      this.settings.NOTIFICATION_QUEUE_V2 ??
      `${this.settings.NOTIFICATION_QUEUE}.v2`
    );
  }
  /** Overridable in tests; delays the requeue of a transient failure. */
  sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  /**
   * Ack only after the inbox transaction commits. Permanent errors are dead-lettered by the
   * broker with the ORIGINAL message (x-death headers keep the reason and queue). Transient
   * errors are requeued after a backoff so the quorum delivery limit spans a real outage.
   */
  async handle(
    message: ConsumeMessage,
    channel: ConfirmChannel,
    legacy = false,
  ) {
    const deliveryCount = Number(
      message.properties?.headers?.['x-delivery-count'] ?? 0,
    );
    const log = (decision: string, error?: unknown, eventId?: string) =>
      this.logger.warn({
        event: 'notification_event_' + decision,
        decision,
        eventId,
        routingKey: message.fields.routingKey,
        deliveryCount: legacy ? undefined : deliveryCount,
        queue: legacy ? 'legacy' : 'quorum',
        errorClass: error instanceof Error ? error.name : undefined,
      });
    let eventId: string | undefined;
    try {
      if (message.content.length > 65536)
        throw new SyntaxError('Message too large');
      const value = JSON.parse(message.content.toString('utf8')) as {
        eventType?: string;
        eventId?: unknown;
      };
      if (typeof value?.eventId === 'string' && value.eventId.length <= 64)
        eventId = value.eventId;
      if (!value || value.eventType !== message.fields.routingKey)
        throw new SyntaxError('Routing key mismatch');
      await this.notifications.consume(value);
      channel.ack(message);
    } catch (error) {
      if (isPermanent(error)) {
        channel.nack(message, false, false);
        log('dead_lettered', error, eventId);
      } else {
        // Classic queues have no delivery count; use a fixed pause there.
        await this.sleep(
          legacy
            ? 5000
            : Math.min(30000, 500 * 2 ** Math.min(deliveryCount, 6)),
        );
        // basic.reject (not nack): RabbitMQ 4 counts only reject/consumer-loss toward x-delivery-limit.
        channel.reject(message, true);
        log('requeued', error, eventId);
      }
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    this.isReady = false;
    clearTimeout(this.timer);
    await this.connecting;
    await this.connection?.close().catch(() => undefined);
  }
}
