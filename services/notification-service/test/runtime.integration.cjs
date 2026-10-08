/* Real PostgreSQL + RabbitMQ + compiled Nest/Fastify. Only test-owned containers and rows. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { createHmac } = require('node:crypto');
const sign = (payload, secret, o) => {
  const part = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${part({ alg: o.algorithm, typ: 'JWT' })}.${part({ ...payload, iss: o.issuer, aud: o.audience })}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
};
const { connect } = require('amqplib');
const { Pool } = require('pg');
const { mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  PrismaDeliveryRepository,
} = require('../dist/infrastructure/prisma.repository');
const { loadSettings, SETTINGS } = require('../dist/config/settings');
const { Notifications } = require('../dist/application/notifications');
const {
  InboxNotifications,
} = require('../dist/application/inbox-notifications');
const { DeliveryWorker } = require('../dist/application/delivery.worker');
const { RabbitConsumer } = require('../dist/infrastructure/rabbit.consumer');
const {
  PrismaInboxRepository,
} = require('../dist/infrastructure/prisma.inbox.repository');
const {
  DeliveryRepository,
  publicPayload,
  DeliveryError,
} = require('../dist/domain/notification');
const { InboxRepository } = require('../dist/domain/inbox');
const {
  NotificationsController,
  InboxNotificationsController,
  HealthController,
  AccessGuard,
  ApiErrorFilter,
} = require('../dist/presentation/http');
const { Module } = require('@nestjs/common');

const databaseName = `notification_runtime_${randomUUID().replaceAll('-', '')}`;
assert.match(databaseName, /^notification_runtime_[a-f0-9]{32}$/);
const settings = loadSettings({
  DB_HOST: '127.0.0.1',
  DB_PORT: '15439',
  DB_NAME: databaseName,
  DB_USERNAME: 'notification_test',
  DB_PASSWORD: 'unused-local-trust',
  DB_SSL_MODE: 'disable',
  JWT_ACCESS_SECRET: 'test-only-key-not-for-production-123456',
  RABBITMQ_USERNAME: 'guest',
  RABBITMQ_PASSWORD: 'guest',
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
const v2EventTypes = [
  'workflow.created',
  'workflow.published',
  'workflow.paused',
  'workflow.resumed',
  'workflow.completed',
  'workflow.failed',
  'workspace.created',
  'workspace.renamed',
  'workspace.member_added',
  'workspace.member_removed',
  'workspace.member_permissions_updated',
  'workspace.member_left',
  'workspace.deleted',
  'connection.connected',
  'connection.disabled',
  'connection.invalid',
  'identity.password_changed',
  'identity.password_reset',
  'identity.google_linked',
  'identity.google_unlinked',
];
function v2EventFor(eventType, recipientUserId = randomUUID()) {
  const workspaceId = randomUUID();
  const workflowId = randomUUID();
  const actorUserId = randomUUID();
  let producer;
  let entity;
  let data;
  let normalizedWorkspaceId = workspaceId;
  let recipients = [recipientUserId];
  if (eventType.startsWith('identity.')) {
    producer = 'identity-service';
    entity = { kind: 'USER', id: recipientUserId };
    data = {};
    normalizedWorkspaceId = null;
  } else if (eventType.startsWith('workflow.')) {
    producer = 'workflow-service';
    if (eventType === 'workflow.completed' || eventType === 'workflow.failed') {
      entity = { kind: 'EXECUTION', id: randomUUID() };
      data = { workflowName: 'Broker integration', workflowId };
    } else {
      entity = { kind: 'WORKFLOW', id: workflowId };
      data = { workflowName: 'Broker integration' };
    }
  } else if (eventType.startsWith('workspace.')) {
    producer = 'workspace-service';
    entity = { kind: 'WORKSPACE', id: workspaceId };
    if (eventType.startsWith('workspace.member_')) {
      const subjectUserId =
        eventType === 'workspace.member_left' ? randomUUID() : recipientUserId;
      data = { workspaceName: 'Broker workspace', subjectUserId };
    } else {
      data = { workspaceName: 'Broker workspace' };
    }
  } else {
    producer = 'workspace-service';
    entity = { kind: 'CONNECTION', id: randomUUID() };
    data = { connectionName: 'Broker connection' };
  }
  if (eventType === 'workspace.member_left') recipients = [recipientUserId];
  const finalActor = eventType.startsWith('identity.')
    ? recipientUserId
    : eventType === 'workspace.member_left'
      ? data.subjectUserId
      : actorUserId;
  return {
    schemaVersion: 2,
    eventId: randomUUID(),
    eventType,
    occurredAt: new Date().toISOString(),
    producer,
    actorUserId: finalActor,
    recipientUserIds: recipients,
    workspaceId: normalizedWorkspaceId,
    entity,
    data,
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
  { timeout: 180000 },
  async (t) => {
    const admin = new Pool({
      host: '127.0.0.1',
      port: 15439,
      database: 'notification_test',
      user: 'notification_test',
    });
    const pool = new Pool({
      host: '127.0.0.1',
      port: 15439,
      database: databaseName,
      user: 'notification_test',
    });
    const repo = new PrismaDeliveryRepository(settings);
    const inboxRepo = new PrismaInboxRepository(settings);
    let connection, channel, app;
    const service = new Notifications(repo, inboxRepo);
    const inboxService = new InboxNotifications(inboxRepo);
    const consumer = new RabbitConsumer(service, settings);
    const events = [];
    const v2Events = [];
    let createdDatabase = false;
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      createdDatabase = true;
      const migrationsRoot = join(__dirname, '../prisma/migrations');
      const migrationDirectories = readdirSync(migrationsRoot, {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const migrationDirectory of migrationDirectories)
        await pool.query(
          readFileSync(
            join(migrationsRoot, migrationDirectory, 'migration.sql'),
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
          // Reading one delivery also read its sibling of the same inbox item (NT-4).
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
        'RabbitMQ v2 catalog, legacy compatibility, JWT inbox HTTP and Gateway proxy',
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
          assert.equal(v2EventTypes.length, 20);
          for (const eventType of v2EventTypes) {
            const v2 = v2EventFor(eventType);
            v2Events.push(v2);
            channel.publish(
              settings.NOTIFICATION_EXCHANGE,
              eventType,
              Buffer.from(JSON.stringify(v2)),
              { persistent: true },
            );
            await channel.waitForConfirms();
            await until(
              async () =>
                (await inboxRepo.client.notificationInbox.count({
                  where: { sourceEventId: v2.eventId },
                })) === 1,
            );
            assert.equal(
              await repo.client.notificationDelivery.count({
                where: { sourceEventId: v2.eventId },
              }),
              0,
            );
          }

          const rejectedEvents = [
            {
              event: {
                ...v2EventFor('workspace.created'),
                schemaVersion: 7,
                privateField: 'do-not-copy-version',
              },
              routingKey: 'workspace.created',
            },
            {
              event: {
                ...v2EventFor('workspace.created'),
                producer: 'identity-service',
                privateField: 'do-not-copy-family',
              },
              routingKey: 'workspace.created',
            },
            {
              event: {
                ...v2EventFor('workspace.created'),
                unknownField: 'do-not-copy-unknown',
              },
              routingKey: 'workspace.created',
            },
            {
              event: v2EventFor('workflow.completed'),
              routingKey: 'workflow.failed',
            },
            {
              event: { secret: 'must-not-copy' },
              routingKey: 'workflow.completed',
            },
          ];
          for (const rejectedEvent of rejectedEvents) {
            channel.publish(
              settings.NOTIFICATION_EXCHANGE,
              rejectedEvent.routingKey,
              Buffer.from(JSON.stringify(rejectedEvent.event)),
              { persistent: true },
            );
            await channel.waitForConfirms();
          }
          for (const _ of rejectedEvents) {
            let rejected;
            await until(async () => {
              rejected = await channel.get(settings.NOTIFICATION_DLQ, {
                noAck: true,
              });
              return Boolean(rejected);
            });
            // The broker dead-letters the ORIGINAL message: body kept, x-death present.
            const original = JSON.parse(rejected.content.toString());
            assert(
              rejectedEvents.some(
                (r) => JSON.stringify(r.event) === JSON.stringify(original),
              ),
            );
            assert(rejected.properties.headers['x-death']);
          }

          class RuntimeModule {}
          Module({
            controllers: [
              NotificationsController,
              InboxNotificationsController,
              HealthController,
            ],
            providers: [
              AccessGuard,
              { provide: SETTINGS, useValue: settings },
              { provide: DeliveryRepository, useValue: repo },
              { provide: InboxRepository, useValue: inboxRepo },
              { provide: Notifications, useValue: service },
              { provide: InboxNotifications, useValue: inboxService },
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
          const tokenFor = (subject) => {
            const now = Math.floor(Date.now() / 1000);
            return sign(
              {
                sub: subject,
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
          };
          const headers = {
            authorization: `Bearer ${tokenFor(e.payload.userId)}`,
          };
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

          const inboxUser = randomUUID();
          const inboxEvents = [
            v2EventFor('workspace.renamed', inboxUser),
            v2EventFor('identity.google_linked', inboxUser),
            v2EventFor('workspace.member_removed', inboxUser),
          ];
          for (const inboxEvent of inboxEvents) {
            v2Events.push(inboxEvent);
            channel.publish(
              settings.NOTIFICATION_EXCHANGE,
              inboxEvent.eventType,
              Buffer.from(JSON.stringify(inboxEvent)),
              { persistent: true },
            );
            await channel.waitForConfirms();
          }
          const inboxEventIds = inboxEvents.map((item) => item.eventId);
          await until(
            async () =>
              (await inboxRepo.client.notificationInbox.count({
                where: {
                  sourceEventId: { in: inboxEventIds },
                  userId: inboxUser,
                },
              })) === 3,
          );
          const tiedCreatedAt = new Date('2026-08-01T12:13:14.015Z');
          await inboxRepo.client.notificationInbox.updateMany({
            where: { sourceEventId: { in: inboxEventIds }, userId: inboxUser },
            data: { createdAt: tiedCreatedAt },
          });
          const inboxHeaders = {
            authorization: `Bearer ${tokenFor(inboxUser)}`,
          };
          const firstPageResponse = await fetch(
            `${url}/api/v2/notifications?limit=2&unreadOnly=true&locale=en`,
            { headers: inboxHeaders },
          );
          assert.equal(firstPageResponse.status, 200);
          const firstPage = await firstPageResponse.json();
          assert.equal(firstPage.items.length, 2);
          assert(firstPage.nextCursor);
          assert.equal(
            firstPage.items[0].createdAt,
            tiedCreatedAt.toISOString(),
          );
          assert.equal('userId' in firstPage.items[0], false);
          assert.equal('sourceEventId' in firstPage.items[0], false);
          assert.equal('provider' in firstPage.items[0], false);
          const secondPageResponse = await fetch(
            `${url}/api/v2/notifications?limit=2&unreadOnly=true&locale=en&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
            { headers: inboxHeaders },
          );
          assert.equal(secondPageResponse.status, 200);
          const secondPage = await secondPageResponse.json();
          const pageIds = [
            ...firstPage.items.map((item) => item.id),
            ...secondPage.items.map((item) => item.id),
          ];
          assert.equal(secondPage.items.length, 1);
          assert.equal(new Set(pageIds).size, 3);
          const expectedIds = await inboxRepo.client.notificationInbox.findMany(
            {
              where: {
                sourceEventId: { in: inboxEventIds },
                userId: inboxUser,
              },
              select: { id: true },
            },
          );
          assert.deepEqual(
            pageIds.slice().sort(),
            expectedIds.map((item) => item.id).sort(),
          );
          const workspacePage = await (
            await fetch(
              `${url}/api/v2/notifications?category=WORKSPACE&locale=en`,
              { headers: inboxHeaders },
            )
          ).json();
          assert.equal(workspacePage.items.length, 2);
          assert.equal(
            workspacePage.items.find(
              (item) => item.eventType === 'workspace.member_removed',
            ).target.kind,
            'NONE',
          );
          assert.equal(
            (
              await (
                await fetch(`${url}/api/v2/notifications/unread-count`, {
                  headers: inboxHeaders,
                })
              ).json()
            ).count,
            3,
          );
          const readId = firstPage.items[0].id;
          const readUrl = `${url}/api/v2/notifications/${readId}/read?locale=en`;
          const readResponse = await fetch(readUrl, {
            method: 'PATCH',
            headers: inboxHeaders,
          });
          assert.equal(readResponse.status, 200);
          const readBody = await readResponse.json();
          assert.equal(readBody.item.readAt !== null, true);
          const readAgain = await (
            await fetch(readUrl, { method: 'PATCH', headers: inboxHeaders })
          ).json();
          assert.equal(readAgain.item.readAt, readBody.item.readAt);
          assert.equal(
            (
              await fetch(`${url}/api/v2/notifications/${readId}/read`, {
                method: 'PATCH',
                headers: { authorization: `Bearer ${tokenFor(randomUUID())}` },
              })
            ).status,
            404,
          );
          const readAllResponse = await fetch(
            `${url}/api/v2/notifications/read-all`,
            { method: 'POST', headers: inboxHeaders },
          );
          assert.equal((await readAllResponse.json()).updatedCount, 2);
          assert.equal(
            (
              await (
                await fetch(`${url}/api/v2/notifications/unread-count`, {
                  headers: inboxHeaders,
                })
              ).json()
            ).count,
            0,
          );

          const { Test } = require('@nestjs/testing');
          const { ConfigService } = require('@nestjs/config');
          const {
            NotificationsModule,
          } = require('../../api-gateway/dist/notifications/notifications.module');
          const gatewayModule = await Test.createTestingModule({
            imports: [NotificationsModule],
          })
            .useMocker((dependency) =>
              dependency === ConfigService
                ? {
                    get: (key) =>
                      key === 'gateway'
                        ? { upstreams: { notification: url } }
                        : key === 'NOTIFICATION_SERVICE_URL'
                          ? url
                          : undefined,
                  }
                : undefined,
            )
            .compile();
          const gateway = gatewayModule.createNestApplication(
            new FastifyAdapter(),
          );
          await gateway.init();
          await gateway.getHttpAdapter().getInstance().ready();
          try {
            await gateway.listen(0, '127.0.0.1');
            const gatewayUrl = await gateway.getUrl();
            const proxied = await fetch(
              `${gatewayUrl}/api/v2/notifications?locale=en&limit=2`,
              { headers: inboxHeaders },
            );
            assert.equal(proxied.status, 200);
            const proxiedBody = await proxied.json();
            assert.equal(proxiedBody.items.length, 2);
            assert.equal(proxied.headers.get('x-request-id') !== null, true);
          } finally {
            await gateway.close();
          }
        },
      );
      await t.test(
        'production AppModule boots with the generated Prisma client and real broker',
        async () => {
          const env = Object.fromEntries(
            Object.entries(settings)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, String(value)]),
          );
          const previous = Object.fromEntries(
            Object.keys(env).map((key) => [key, process.env[key]]),
          );
          const previousCwd = process.cwd();
          const isolatedConfigDirectory = mkdtempSync(
            join(tmpdir(), 'weav-notification-no-env-'),
          );
          let production;
          try {
            process.chdir(isolatedConfigDirectory);
            Object.assign(process.env, env);
            const { AppModule } = require('../dist/app.module');
            production = await NestFactory.create(
              AppModule,
              new FastifyAdapter(),
              { logger: false, abortOnError: false },
            );
            await production.listen(0, '127.0.0.1');
            await until(() => production.get(RabbitConsumer).isReady);
            const url = await production.getUrl();
            assert.equal((await fetch(`${url}/health`)).status, 200);
            assert.equal((await fetch(`${url}/ready`)).status, 200);
            assert.equal(
              (await fetch(`${url}/api/v1/notifications`)).status,
              401,
            );
          } catch (error) {
            process.stderr.write(
              `runtime integration production boot failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
            );
            throw error;
          } finally {
            if (production) await production.close();
            process.chdir(previousCwd);
            rmSync(isolatedConfigDirectory, { recursive: true, force: true });
            for (const [key, value] of Object.entries(previous)) {
              if (value === undefined) delete process.env[key];
              else process.env[key] = value;
            }
          }
        },
      );
    } finally {
      if (app) await app.close();
      await consumer.onModuleDestroy();
      if (channel) await channel.close().catch(() => {});
      if (connection) await connection.close().catch(() => {});
      await repo.client.notificationDelivery.deleteMany({
        where: { sourceEventId: { in: events.map((e) => e.eventId) } },
      });
      await inboxRepo.client.notificationDelivery.deleteMany({
        where: {
          sourceEventId: {
            in: [...events, ...v2Events].map((item) => item.eventId),
          },
        },
      });
      await inboxRepo.client.notificationInbox.deleteMany({
        where: {
          sourceEventId: {
            in: [...events, ...v2Events].map((item) => item.eventId),
          },
        },
      });
      await repo.onModuleDestroy();
      await inboxRepo.onModuleDestroy();
      await pool.end();
      if (createdDatabase) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
