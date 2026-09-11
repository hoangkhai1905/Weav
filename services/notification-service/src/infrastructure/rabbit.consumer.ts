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
      await channel.assertQueue(s.NOTIFICATION_QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': s.NOTIFICATION_DLQ,
        },
      });
      for (const key of ['workflow.completed', 'workflow.failed'])
        await channel.bindQueue(
          s.NOTIFICATION_QUEUE,
          s.NOTIFICATION_EXCHANGE,
          key,
        );
      await channel.prefetch(1);
      await channel.consume(
        s.NOTIFICATION_QUEUE,
        (message) => {
          if (!message) {
            void connection.close().catch(() => undefined);
            return;
          }
          void this.handle(message, channel).catch(() => {
            void connection.close().catch(() => undefined);
          });
        },
        { noAck: false },
      );
      this.isReady = true;
      if (this.stopped) await connection.close();
    } catch {
      await connection.close().catch(() => undefined);
      throw new Error('Broker setup failed');
    }
  }
  async handle(message: ConsumeMessage, channel: ConfirmChannel) {
    try {
      if (message.content.length > 65536)
        throw new SyntaxError('Message too large');
      const value = JSON.parse(message.content.toString('utf8')) as {
        eventType?: string;
      };
      if (!value || value.eventType !== message.fields.routingKey)
        throw new SyntaxError('Routing key mismatch');
      await this.notifications.consume(value);
      channel.ack(message);
      this.retry = 0;
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof ZodError) {
        // Publish a sanitized durable DLQ record with confirms before acknowledging the original.
        await new Promise<void>((resolve, reject) => {
          channel.sendToQueue(
            this.settings.NOTIFICATION_DLQ,
            Buffer.from(
              JSON.stringify({
                code: 'INVALID_EXECUTION_EVENT',
                occurredAt: new Date().toISOString(),
              }),
            ),
            { persistent: true, contentType: 'application/json' },
            (err: unknown) =>
              err
                ? reject(
                    err instanceof Error
                      ? err
                      : new Error('DLQ confirmation failed'),
                  )
                : resolve(),
          );
        });
        channel.ack(message);
        this.logger.warn({ event: 'notification_event_rejected' });
      } else {
        // Closing the connection requeues the unacked message; reconnect backoff prevents a hot loop.
        throw new Error('Event persistence unavailable');
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
