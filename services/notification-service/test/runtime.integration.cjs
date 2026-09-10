/* Real PostgreSQL + RabbitMQ + compiled Nest/Fastify. Only test-owned containers and rows. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { sign } = require('jsonwebtoken');
const { connect } = require('amqplib');
const { Pool } = require('pg');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  PrismaDeliveryRepository,
} = require('../dist/infrastructure/prisma.repository');
const { loadSettings, SETTINGS } = require('../dist/config/settings');
const { Notifications } = require('../dist/application/notifications');
const { DeliveryWorker } = require('../dist/application/delivery.worker');
const { RabbitConsumer } = require('../dist/infrastructure/rabbit.consumer');
const {
  DeliveryRepository,
  publicPayload,
  DeliveryError,
} = require('../dist/domain/notification');
const {
  NotificationsController,
  HealthController,
  AccessGuard,
  ApiErrorFilter,
} = require('../dist/presentation/http');
const { Module } = require('@nestjs/common');

const settings = loadSettings({
  DB_HOST: '127.0.0.1',
  DB_PORT: '15439',
  DB_NAME: 'notification_test',
  DB_USERNAME: 'notification_test',
  DB_PASSWORD: 'unused-local-trust',
  DB_SSL_MODE: 'disable',
  JWT_ACCESS_SECRET: 'test-only-key-not-for-production-123456',
  RABBITMQ_HOST: '127.0.0.1',
  RABBITMQ_PORT: '15689',
  NOTIFICATION_EXCHANGE: 'weav.notification.test.events',
  NOTIFICATION_QUEUE: 'weav.notification.test.queue',
  NOTIFICATION_DLQ: 'weav.notification.test.dlq',
});
function event() {
  const executionId = randomUUID();
  return {
    eventId: randomUUID(),
    eventType: 'workflow.completed',
    aggregateType: 'workflow_execution',
    aggregateId: executionId,
    occurredAt: new Date().toISOString(),
    payload: {
      executionId,
      workflowId: randomUUID(),
      workspaceId: randomUUID(),
      userId: randomUUID(),
      workflowName: 'Integration fixture',
      status: 'SUCCESS',
      finishedAt: new Date().toISOString(),
      recipients: [
        { provider: 'TELEGRAM', destination: '12345' },
        {
          provider: 'EXPO_PUSH',
          destination: 'ExponentPushToken[test-device]',
        },
      ],
    },
  };
}
async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('Timed out waiting for test condition');
}
test(
  'real notification persistence, concurrency, broker and HTTP',
  { timeout: 60000 },
  async (t) => {
    const pool = new Pool({
      host: '127.0.0.1',
      port: 15439,
      database: 'notification_test',
      user: 'notification_test',
    });
    const repo = new PrismaDeliveryRepository(settings);
    let connection, channel, app;
    const service = new Notifications(repo);
    const consumer = new RabbitConsumer(service, settings);
    const events = [];
    try {
      const exists = await pool.query(
        "SELECT to_regclass('notification.notification_deliveries') AS name",
      );
      if (!exists.rows[0].name)
        await pool.query(
          readFileSync(
            join(
              __dirname,
              '../prisma/migrations/202609090001_notification_deliveries/migration.sql',
            ),
            'utf8',
          ),
        );
      await t.test(
        'concurrent event replay is idempotent and atomic',
        async () => {
          const e = event();
          events.push(e);
          await Promise.all(
            Array.from({ length: 6 }, () => repo.ingest(e, publicPayload(e))),
          );
          assert.equal(
            await repo.client.notificationDelivery.count({
              where: { sourceEventId: e.eventId },
            }),
            2,
          );
          await repo.ingest(
            {
              ...e,
              payload: {
                ...e.payload,
                recipients: [{ provider: 'TELEGRAM', destination: '99999' }],
              },
            },
            publicPayload(e),
          );
          assert.equal(
            await repo.client.notificationDelivery.count({
              where: { sourceEventId: e.eventId },
            }),
            2,
          );
          assert.equal(
            (await repo.list(randomUUID(), { limit: 20 })).length,
            0,
          );
        },
      );
      await t.test(
        'concurrent claims are exclusive, reads preserve leases, stale completions cannot overwrite',
        async () => {
          const claims = await Promise.all([
            repo.claim(5, 60000),
            repo.claim(5, 60000),
          ]);
          assert.equal(new Set(claims.map((d) => d.id)).size, 2);
          const row = claims[0];
          assert.equal(await repo.markRead(randomUUID(), row.id), null);
          const read = await repo.markRead(row.userId, row.id);
          const again = await repo.markRead(row.userId, row.id);
          assert.equal(read.readAt.getTime(), again.readAt.getTime());
          await repo.finish(row, {
            status: 'SENT',
            sentAt: new Date(),
            scheduledAt: null,
          });
          assert.equal(
            (
              await repo.client.notificationDelivery.findUnique({
                where: { id: row.id },
              })
            ).status,
            'SENT',
          );
          const stale = claims[1];
          await repo.client.notificationDelivery.update({
            where: { id: stale.id },
            data: { updatedAt: new Date(Date.now() - 120000) },
          });
          const fresh = await repo.claim(5, 60000);
          assert.equal(fresh.id, stale.id);
          assert.equal(fresh.retryCount, 2);
          await repo.finish(stale, { status: 'SENT', scheduledAt: null });
          assert.equal(
            (
              await repo.client.notificationDelivery.findUnique({
                where: { id: fresh.id },
              })
            ).status,
            'SENDING',
          );
          await repo.finish(fresh, { status: 'FAILED', scheduledAt: null });
          assert.equal(await repo.markAllRead(row.userId), 1);
          assert.equal(await repo.markAllRead(row.userId), 0);
          assert.equal(await repo.unreadCount(row.userId), 0);
        },
      );
      await t.test(
        'real worker retries persisted transient failure and stops permanent failure',
        async () => {
          const e = event();
          events.push(e);
          await service.consume(e);
          let calls = 0;
          const worker = new DeliveryWorker(repo, settings, {
            TELEGRAM: {
              send: async () => {
                calls++;
                if (calls === 1)
                  throw new DeliveryError('TRANSIENT_TEST', true);
                return { kind: 'sent' };
              },
            },
            EXPO_PUSH: {
              send: async () => {
                throw new DeliveryError('PERMANENT_TEST', false);
              },
            },
          });
          await worker.tick();
          await worker.tick();
          await repo.client.notificationDelivery.updateMany({
            where: { sourceEventId: e.eventId, provider: 'TELEGRAM' },
            data: { scheduledAt: new Date(0) },
          });
          await worker.tick();
          const rows = await repo.list(e.payload.userId, { limit: 20 });
          assert.equal(
            rows.find((r) => r.provider === 'TELEGRAM').status,
            'SENT',
          );
          assert.equal(
            rows.find((r) => r.provider === 'EXPO_PUSH').scheduledAt,
            null,
          );
          assert.equal(calls, 2);
        },
      );
      await t.test(
        'RabbitMQ events reach the inbox and malformed messages reach sanitized DLQ',
        async () => {
          consumer.onModuleInit();
          await until(() => consumer.isReady);
          connection = await connect({ hostname: '127.0.0.1', port: 15689 });
          channel = await connection.createConfirmChannel();
          const e = event();
          events.push(e);
          channel.publish(
            settings.NOTIFICATION_EXCHANGE,
            e.eventType,
            Buffer.from(JSON.stringify(e)),
            { persistent: true },
          );
          await channel.waitForConfirms();
          await until(
            async () => (await repo.unreadCount(e.payload.userId)) === 2,
          );
          channel.publish(
            settings.NOTIFICATION_EXCHANGE,
            e.eventType,
            Buffer.from('{"secret":"must-not-copy"}'),
            { persistent: true },
          );
          await channel.waitForConfirms();
          let rejected;
          await until(async () => {
            rejected = await channel.get(settings.NOTIFICATION_DLQ, {
              noAck: true,
            });
            return Boolean(rejected);
          });
          assert(!rejected.content.toString().includes('must-not-copy'));
          class RuntimeModule {}
          Module({
            controllers: [NotificationsController, HealthController],
            providers: [
              AccessGuard,
              { provide: SETTINGS, useValue: settings },
              { provide: DeliveryRepository, useValue: repo },
              { provide: Notifications, useValue: service },
              {
                provide: RabbitConsumer,
                useValue: {
                  get isReady() {
                    return consumer.isReady;
                  },
                },
              },
            ],
          })(RuntimeModule);
          app = await NestFactory.create(RuntimeModule, new FastifyAdapter(), {
            logger: false,
          });
          app.useGlobalFilters(new ApiErrorFilter());
          await app.listen(0, '127.0.0.1');
          const url = await app.getUrl();
          const now = Math.floor(Date.now() / 1000);
          const token = sign(
            {
              sub: e.payload.userId,
              sid: randomUUID(),
              jti: randomUUID(),
              token_use: 'access',
              user_status: 'ACTIVE',
              system_role: 'USER',
              iat: now,
              nbf: now,
              exp: now + 60,
            },
            settings.JWT_ACCESS_SECRET,
            {
              algorithm: 'HS256',
              issuer: settings.JWT_ISSUER,
              audience: settings.JWT_AUDIENCE,
            },
          );
          const headers = { authorization: `Bearer ${token}` };
          const response = await fetch(`${url}/api/notifications?limit=1`, {
            headers,
          });
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.equal(body.items.length, 1);
          assert(body.nextCursor);
          const next = await (
            await fetch(
              `${url}/api/notifications?limit=1&cursor=${body.nextCursor}`,
              { headers },
            )
          ).json();
          assert.notEqual(next.items[0].id, body.items[0].id);
          assert.equal((await fetch(`${url}/api/notifications`)).status, 401);
          assert.equal((await fetch(`${url}/ready`)).status, 200);
          const marked = await fetch(`${url}/api/notifications/read-all`, {
            method: 'POST',
            headers,
          });
          assert.equal((await marked.json()).updatedCount, 2);
        },
      );
      await t.test('production AppModule boots with the generated Prisma client and real broker', async () => {
        const env = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
        const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
        Object.assign(process.env, env);
        let production;
        try {
          const { AppModule } = require('../dist/app.module');
          production = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
          await production.listen(0, '127.0.0.1');
          await until(() => production.get(RabbitConsumer).isReady);
          const url = await production.getUrl();
          assert.equal((await fetch(`${url}/health`)).status, 200);
          assert.equal((await fetch(`${url}/ready`)).status, 200);
          assert.equal((await fetch(`${url}/api/v1/notifications`)).status, 401);
        } finally {
          if (production) await production.close();
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
          }
        }
      });
    } finally {
      if (app) await app.close();
      await consumer.onModuleDestroy();
      if (channel) await channel.close().catch(() => {});
      if (connection) await connection.close().catch(() => {});
      await repo.client.notificationDelivery.deleteMany({
        where: { sourceEventId: { in: events.map((e) => e.eventId) } },
      });
      await repo.onModuleDestroy();
      await pool.end();
    }
  },
);
