const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { Pool } = require('pg');
const { loadSettings } = require('../dist/config/settings');
const { inboxDedupKey, inboxIdForKey } = require('../dist/domain/inbox');
const {
  PrismaInboxRepository,
} = require('../dist/infrastructure/prisma.inbox.repository');
const {
  PrismaDeliveryRepository,
} = require('../dist/infrastructure/prisma.repository');
const { Notifications } = require('../dist/application/notifications');
const { RabbitConsumer } = require('../dist/infrastructure/rabbit.consumer');

const repositoryRoot = join(__dirname, '..');
const databaseName = `notification_inbox_${randomUUID().replaceAll('-', '')}`;
assert.match(databaseName, /^notification_inbox_[a-f0-9]{32}$/);
const fixRoundSourceEventIds = new Set();

function testSettings(database) {
  return loadSettings({
    DB_HOST: '127.0.0.1',
    DB_PORT: '15439',
    DB_NAME: database,
    DB_USERNAME: 'notification_test',
    DB_PASSWORD: 'unused-local-trust',
    DB_SSL_MODE: 'disable',
    JWT_ACCESS_SECRET: 'test-only-key-not-for-production-123456',
    RABBITMQ_USERNAME: 'guest',
    RABBITMQ_PASSWORD: 'guest',
  });
}

function migrationUrl(database) {
  const url = new URL('postgresql://127.0.0.1:15439');
  url.username = 'notification_test';
  url.pathname = `/${database}`;
  url.searchParams.set('schema', 'notification');
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
}

function deployMigrations(database) {
  const result = spawnSync(
    process.execPath,
    [
      join(repositoryRoot, 'node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
    ],
    {
      cwd: repositoryRoot,
      timeout: 30000,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        NOTIFICATION_MIGRATION_URL: migrationUrl(database),
      },
    },
  );
  assert.equal(
    result.status,
    0,
    'Disposable inbox migration deployment failed',
  );
}

function v2Event(recipientUserIds = [randomUUID()], overrides = {}) {
  return {
    schemaVersion: 2,
    eventId: randomUUID(),
    eventType: 'workflow.completed',
    occurredAt: '2026-09-26T10:00:00.000Z',
    producer: 'workflow-service',
    actorUserId: null,
    recipientUserIds,
    workspaceId: randomUUID(),
    entity: { kind: 'EXECUTION', id: randomUUID() },
    data: { workflowName: 'Daily report', workflowId: randomUUID() },
    ...overrides,
  };
}

function legacyEvent(overrides = {}) {
  const executionId = randomUUID();
  const event = {
    eventId: randomUUID(),
    eventType: 'workflow.completed',
    occurredAt: '2026-09-27T10:00:00.000Z',
    aggregateType: 'workflow_execution',
    aggregateId: executionId,
    payload: {
      executionId,
      workflowId: randomUUID(),
      workspaceId: randomUUID(),
      userId: randomUUID(),
      workflowName: 'Atomic legacy event',
      status: 'SUCCESS',
      finishedAt: '2026-09-27T10:00:00.000Z',
      recipients: [
        { provider: 'TELEGRAM', destination: 'test-telegram-destination' },
        { provider: 'EXPO_PUSH', destination: 'test-expo-destination' },
      ],
    },
  };
  return {
    ...event,
    ...overrides,
    payload: { ...event.payload, ...overrides.payload },
  };
}

function inboxContent(category = 'WORKFLOW', severity = 'INFO') {
  return {
    vi: {
      category,
      severity,
      title: 'Thông báo kiểm tra',
      message: 'Nội dung kiểm tra.',
      target: { kind: 'NONE' },
    },
    en: {
      category,
      severity,
      title: 'Test notification',
      message: 'Test content.',
      target: { kind: 'NONE' },
    },
  };
}

async function seedInbox(repo, options = {}) {
  const userId = options.userId || randomUUID();
  const sourceEventId =
    options.sourceEventId === undefined ? randomUUID() : options.sourceEventId;
  const dedupKey = `test:${randomUUID()}`;
  return repo.client.notificationInbox.create({
    data: {
      id: inboxIdForKey(dedupKey),
      dedupKey,
      sourceEventId,
      userId,
      eventType: options.eventType || 'workflow.completed',
      category: options.category || 'WORKFLOW',
      severity: options.severity || 'INFO',
      workspaceId: options.workspaceId || null,
      actorUserId: null,
      executionId: options.executionId || null,
      content: inboxContent(
        options.category || 'WORKFLOW',
        options.severity || 'INFO',
      ),
      occurredAt: options.occurredAt || new Date('2025-01-01T00:00:00.000Z'),
      createdAt: options.createdAt || new Date('2025-01-01T00:00:00.000Z'),
      readAt: options.readAt === undefined ? null : options.readAt,
    },
  });
}

async function seedReadInbox(repo, { sourceEventId, userId, executionId }) {
  fixRoundSourceEventIds.add(sourceEventId);
  await repo.ingest(
    v2Event([userId], {
      eventId: sourceEventId,
      entity: { kind: 'EXECUTION', id: executionId },
    }),
  );
  const item = await repo.client.notificationInbox.findUnique({
    where: { sourceEventId_userId: { sourceEventId, userId } },
  });
  assert(item);
  return repo.client.notificationInbox.update({
    where: { id: item.id },
    data: {
      content: inboxContent('WORKFLOW', 'SUCCESS'),
      createdAt: new Date('2025-01-02T03:04:05.006Z'),
      readAt: new Date('2026-01-02T03:04:05.006Z'),
    },
  });
}

async function seedDelivery(repo, options = {}) {
  const id = options.id || randomUUID();
  const workflowId = options.workflowId || randomUUID();
  const workspaceId = options.workspaceId || randomUUID();
  const payload = {
    workflowName: options.workflowName || 'Legacy daily report',
    workflowId,
    workspaceId,
    title: 'UNTRUSTED OLD TITLE',
    message: 'UNTRUSTED OLD MESSAGE',
    error: 'private provider or execution error',
    _receiptId: 'private-receipt-id',
    ...(options.payload || {}),
  };
  return repo.client.notificationDelivery.create({
    data: {
      id,
      userId: options.userId || randomUUID(),
      executionId:
        options.executionId === undefined ? randomUUID() : options.executionId,
      sourceEventId:
        options.sourceEventId === undefined ? null : options.sourceEventId,
      provider: options.provider || 'TELEGRAM',
      destination: options.destination || `test-destination-${id}`,
      eventType: options.eventType || 'workflow.completed',
      payload,
      status: options.status || 'SENDING',
      retryCount: options.retryCount === undefined ? 2 : options.retryCount,
      lastError: { code: 'PRIVATE', message: 'private legacy failure' },
      readAt: options.readAt === undefined ? null : options.readAt,
      scheduledAt: new Date('2025-02-03T04:05:06.007Z'),
      sentAt: null,
      createdAt: options.createdAt || new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: options.updatedAt || new Date('2025-01-02T00:00:00.000Z'),
    },
  });
}

function legacyFields(row) {
  const { inboxId, ...fields } = row;
  return fields;
}

test('operator reconciliation refuses writes without --apply before reading settings', () => {
  const env = { ...process.env };
  for (const name of [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_SSL_MODE',
    'JWT_ACCESS_SECRET',
  ])
    delete env[name];
  const result = spawnSync(
    process.execPath,
    [join(repositoryRoot, 'scripts/reconcile-inbox.cjs')],
    { cwd: repositoryRoot, env, encoding: 'utf8', windowsHide: true },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Usage:.*--apply/s);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /Invalid notification configuration/,
  );

  const invalidBatch = spawnSync(
    process.execPath,
    [
      join(repositoryRoot, 'scripts/reconcile-inbox.cjs'),
      '--apply',
      '--batch-size',
      '1001',
    ],
    { cwd: repositoryRoot, env, encoding: 'utf8', windowsHide: true },
  );
  assert.notEqual(invalidBatch.status, 0);
  assert.match(`${invalidBatch.stdout}${invalidBatch.stderr}`, /batch-size/i);
  assert.doesNotMatch(
    `${invalidBatch.stdout}${invalidBatch.stderr}`,
    /Invalid notification configuration/,
  );
});

test(
  'PostgreSQL inbox persistence, deduplication, read state and legacy reconciliation',
  { timeout: 180000 },
  async (t) => {
    const admin = new Pool({
      host: '127.0.0.1',
      port: 15439,
      user: 'notification_test',
      database: 'notification_test',
    });
    let createdDatabase = false;
    let repo;
    let deliveryRepo;
    let service;
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      createdDatabase = true;
      deployMigrations(databaseName);
      repo = new PrismaInboxRepository(testSettings(databaseName));
      deliveryRepo = new PrismaDeliveryRepository(testSettings(databaseName));
      service = new Notifications(deliveryRepo, repo);
      t.afterEach(async () => {
        const sourceEventIds = [...fixRoundSourceEventIds];
        fixRoundSourceEventIds.clear();
        if (sourceEventIds.length === 0) return;
        await deliveryRepo.client.notificationDelivery.deleteMany({
          where: { sourceEventId: { in: sourceEventIds } },
        });
        await repo.client.notificationInbox.deleteMany({
          where: { sourceEventId: { in: sourceEventIds } },
        });
      });

      await t.test(
        'legacy workflow persists its unchanged deliveries and one linked inbox item',
        async () => {
          const event = legacyEvent();
          await service.consume(event);
          const deliveries =
            await deliveryRepo.client.notificationDelivery.findMany({
              where: { sourceEventId: event.eventId },
            });
          const inboxItems = await repo.client.notificationInbox.findMany({
            where: { sourceEventId: event.eventId },
          });
          assert.equal(deliveries.length, 2);
          assert.equal(inboxItems.length, 1);
          assert.equal(inboxItems[0].userId, event.payload.userId);
          assert.equal(
            deliveries.every(
              (delivery) => delivery.inboxId === inboxItems[0].id,
            ),
            true,
          );
          assert.equal(await deliveryRepo.unreadCount(event.payload.userId), 2);
          assert.equal(await repo.unreadCount(event.payload.userId), 1);

          await service.consume(
            legacyEvent({
              ...event,
              eventId: event.eventId.toUpperCase(),
              aggregateId: event.aggregateId.toUpperCase(),
              payload: {
                ...event.payload,
                executionId: event.payload.executionId.toUpperCase(),
                userId: event.payload.userId.toUpperCase(),
                recipients: [
                  { provider: 'TELEGRAM', destination: 'changed-replay' },
                ],
              },
            }),
          );
          await service.consume(
            legacyEvent({
              ...event,
              payload: {
                ...event.payload,
                userId: randomUUID(),
                recipients: [
                  { provider: 'TELEGRAM', destination: 'changed-user-replay' },
                ],
              },
            }),
          );
          assert.equal(
            await deliveryRepo.client.notificationDelivery.count({
              where: { sourceEventId: event.eventId },
            }),
            2,
          );
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId: event.eventId },
            }),
            1,
          );
        },
      );

      await t.test(
        'first persisted event representation freezes recipients across legacy and v2 replays',
        async () => {
          const legacyFirst = legacyEvent();
          await service.consume(legacyFirst);
          const extraV2Recipient = randomUUID();
          await service.consume(
            v2Event([legacyFirst.payload.userId, extraV2Recipient], {
              eventId: legacyFirst.eventId,
              eventType: legacyFirst.eventType,
              workspaceId: legacyFirst.payload.workspaceId,
              entity: {
                kind: 'EXECUTION',
                id: legacyFirst.payload.executionId,
              },
              data: {
                workflowName: 'Changed v2 content',
                workflowId: legacyFirst.payload.workflowId,
              },
            }),
          );
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId: legacyFirst.eventId },
            }),
            1,
          );
          assert.equal(await repo.unreadCount(extraV2Recipient), 0);

          const v2FirstUser = randomUUID();
          const v2OnlyEvent = v2Event([v2FirstUser]);
          await service.consume(v2OnlyEvent);
          const collidingLegacy = legacyEvent({
            eventId: v2OnlyEvent.eventId,
            aggregateId: v2OnlyEvent.entity.id,
            payload: {
              userId: randomUUID(),
              executionId: v2OnlyEvent.entity.id,
              workspaceId: v2OnlyEvent.workspaceId,
              workflowId: v2OnlyEvent.data.workflowId,
            },
          });
          await service.consume(collidingLegacy);
          assert.equal(
            await deliveryRepo.client.notificationDelivery.count({
              where: { sourceEventId: v2OnlyEvent.eventId },
            }),
            0,
          );
          assert.equal(await repo.unreadCount(v2FirstUser), 1);
        },
      );

      await t.test(
        'v2 replay repairs old unseeded legacy deliveries from stored recipients only',
        async () => {
          const legacyUser = randomUUID();
          const v2OnlyRecipient = randomUUID();
          const sourceEventId = randomUUID();
          const executionId = randomUUID();
          const stored = await seedDelivery(repo, {
            sourceEventId,
            userId: legacyUser,
            executionId,
            workflowName: 'Stored original name',
          });
          await service.consume(
            v2Event([legacyUser, v2OnlyRecipient], {
              eventId: sourceEventId,
              entity: { kind: 'EXECUTION', id: executionId },
            }),
          );
          const item = await repo.client.notificationInbox.findUnique({
            where: {
              sourceEventId_userId: { sourceEventId, userId: legacyUser },
            },
          });
          assert(item);
          assert.equal(
            item.content.en.message.includes('Stored original name'),
            true,
          );
          assert.equal(await repo.unreadCount(v2OnlyRecipient), 0);
          assert.equal(
            (
              await deliveryRepo.client.notificationDelivery.findUnique({
                where: { id: stored.id },
              })
            ).inboxId,
            item.id,
          );
        },
      );

      await t.test(
        'conflicting persisted eventType or execution identity is a terminal sanitized conflict',
        async () => {
          const sourceEventId = randomUUID();
          const userId = randomUUID();
          const first = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId: randomUUID(),
          });
          const second = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId: randomUUID(),
            eventType: 'workflow.failed',
            provider: 'EXPO_PUSH',
          });
          const incoming = legacyEvent({
            eventId: sourceEventId,
            payload: { userId },
          });
          await assert.rejects(
            service.consume(incoming),
            (error) => error && error.name === 'InboxPersistenceConflictError',
          );
          const rows = await deliveryRepo.client.notificationDelivery.findMany({
            where: { id: { in: [first.id, second.id] } },
          });
          assert(rows.every((row) => row.inboxId === null));
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId, userId },
            }),
            0,
          );
          await deliveryRepo.client.notificationDelivery.deleteMany({
            where: { id: { in: [first.id, second.id] } },
          });
        },
      );

      await t.test(
        'an existing inbox eventType or execution conflict is rejected without relabeling links',
        async () => {
          const sourceEventId = randomUUID();
          const userId = randomUUID();
          const executionId = randomUUID();
          const delivery = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
            eventType: 'workflow.completed',
          });
          const wrongInbox = await seedInbox(repo, {
            sourceEventId,
            userId,
            eventType: 'workflow.failed',
            executionId: randomUUID(),
          });
          await assert.rejects(
            service.consume(
              legacyEvent({
                eventId: sourceEventId,
                aggregateId: executionId,
                payload: { userId, executionId },
              }),
            ),
            (error) => error && error.name === 'InboxPersistenceConflictError',
          );
          const unchanged =
            await deliveryRepo.client.notificationDelivery.findUnique({
              where: { id: delivery.id },
            });
          assert.equal(unchanged.inboxId, null);
          assert.equal(
            (
              await repo.client.notificationInbox.findUnique({
                where: { id: wrongInbox.id },
              })
            ).eventType,
            'workflow.failed',
          );
          await deliveryRepo.client.notificationDelivery.delete({
            where: { id: delivery.id },
          });
          await repo.client.notificationInbox.delete({
            where: { id: wrongInbox.id },
          });
        },
      );

      await t.test(
        'legacy replay repairs stored user groups without changing a read inbox or legacy fields',
        async () => {
          const sourceEventId = randomUUID();
          fixRoundSourceEventIds.add(sourceEventId);
          const executionId = randomUUID();
          const inboxUser = randomUUID();
          const storedOnlyUser = randomUUID();
          const replayOnlyUser = randomUUID();
          const existing = await seedReadInbox(repo, {
            sourceEventId,
            userId: inboxUser,
            executionId,
          });
          const first = await seedDelivery(repo, {
            sourceEventId,
            userId: inboxUser,
            executionId,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          });
          const second = await seedDelivery(repo, {
            sourceEventId,
            userId: storedOnlyUser,
            executionId,
            createdAt: new Date('2024-01-02T00:00:00.000Z'),
          });
          const third = await seedDelivery(repo, {
            sourceEventId,
            userId: storedOnlyUser,
            executionId,
            provider: 'EXPO_PUSH',
            createdAt: new Date('2024-01-03T00:00:00.000Z'),
          });
          const before = new Map(
            [first, second, third].map((row) => [row.id, legacyFields(row)]),
          );

          await service.consume(
            legacyEvent({
              eventId: sourceEventId,
              aggregateId: executionId,
              payload: {
                userId: replayOnlyUser,
                executionId,
                recipients: [
                  {
                    provider: 'TELEGRAM',
                    destination: 'replay-only-destination',
                  },
                ],
              },
            }),
          );

          const inboxItems = await repo.client.notificationInbox.findMany({
            where: { sourceEventId },
          });
          assert.deepEqual(
            inboxItems.map((item) => item.userId).sort(),
            [inboxUser, storedOnlyUser].sort(),
          );
          assert.deepEqual(
            await repo.client.notificationInbox.findUnique({
              where: { id: existing.id },
            }),
            existing,
          );
          const storedInbox = inboxItems.find(
            (item) => item.userId === storedOnlyUser,
          );
          const deliveries =
            await deliveryRepo.client.notificationDelivery.findMany({
              where: { sourceEventId },
            });
          assert.equal(deliveries.length, 3);
          for (const delivery of deliveries) {
            assert.deepEqual(legacyFields(delivery), before.get(delivery.id));
            assert.equal(
              delivery.inboxId,
              delivery.userId === inboxUser ? existing.id : storedInbox.id,
            );
          }
          assert.equal(
            deliveries.some(
              (row) => row.destination === 'replay-only-destination',
            ),
            false,
          );
        },
      );

      await t.test(
        'case-variant v2 replay repairs pending stored groups and ignores replay-only recipients',
        async () => {
          const sourceEventId = randomUUID();
          const executionId = randomUUID();
          const inboxUser = randomUUID();
          const storedOnlyUser = randomUUID();
          const replayOnlyUser = randomUUID();
          const existing = await seedReadInbox(repo, {
            sourceEventId,
            userId: inboxUser,
            executionId,
          });
          const first = await seedDelivery(repo, {
            sourceEventId,
            userId: inboxUser,
            executionId,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          });
          const second = await seedDelivery(repo, {
            sourceEventId,
            userId: storedOnlyUser,
            executionId,
            createdAt: new Date('2024-01-02T00:00:00.000Z'),
          });
          const before = new Map(
            [first, second].map((row) => [row.id, legacyFields(row)]),
          );

          await repo.ingest(
            v2Event([inboxUser, replayOnlyUser], {
              eventId: sourceEventId.toUpperCase(),
              entity: { kind: 'EXECUTION', id: executionId },
            }),
          );

          const inboxItems = await repo.client.notificationInbox.findMany({
            where: { sourceEventId },
          });
          assert.deepEqual(
            inboxItems.map((item) => item.userId).sort(),
            [inboxUser, storedOnlyUser].sort(),
          );
          assert.deepEqual(
            await repo.client.notificationInbox.findUnique({
              where: { id: existing.id },
            }),
            existing,
          );
          const storedInbox = inboxItems.find(
            (item) => item.userId === storedOnlyUser,
          );
          const deliveries =
            await deliveryRepo.client.notificationDelivery.findMany({
              where: { sourceEventId },
            });
          assert.equal(deliveries.length, 2);
          for (const delivery of deliveries) {
            assert.deepEqual(legacyFields(delivery), before.get(delivery.id));
            assert.equal(
              delivery.inboxId,
              delivery.userId === inboxUser ? existing.id : storedInbox.id,
            );
          }
        },
      );

      await t.test(
        'legacy replay seeds every unseeded stored user group rather than treating them as one group',
        async () => {
          const sourceEventId = randomUUID();
          fixRoundSourceEventIds.add(sourceEventId);
          const executionId = randomUUID();
          const firstUser = randomUUID();
          const secondUser = randomUUID();
          const replayOnlyUser = randomUUID();
          const first = await seedDelivery(repo, {
            sourceEventId,
            userId: firstUser,
            executionId,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          });
          const second = await seedDelivery(repo, {
            sourceEventId,
            userId: secondUser,
            executionId,
            createdAt: new Date('2024-01-02T00:00:00.000Z'),
          });
          const before = new Map(
            [first, second].map((row) => [row.id, legacyFields(row)]),
          );

          await service.consume(
            legacyEvent({
              eventId: sourceEventId,
              aggregateId: executionId,
              payload: {
                userId: replayOnlyUser,
                executionId,
                recipients: [
                  {
                    provider: 'TELEGRAM',
                    destination: 'replay-only-destination',
                  },
                ],
              },
            }),
          );

          const inboxItems = await repo.client.notificationInbox.findMany({
            where: { sourceEventId },
          });
          assert.deepEqual(
            inboxItems.map((item) => item.userId).sort(),
            [firstUser, secondUser].sort(),
          );
          const deliveries =
            await deliveryRepo.client.notificationDelivery.findMany({
              where: { sourceEventId },
            });
          assert.equal(deliveries.length, 2);
          for (const delivery of deliveries) {
            assert.deepEqual(legacyFields(delivery), before.get(delivery.id));
            assert.equal(
              delivery.inboxId,
              inboxItems.find((item) => item.userId === delivery.userId).id,
            );
          }
        },
      );

      for (const replayPath of ['legacy', 'v2']) {
        for (const conflictKind of ['eventType', 'executionId', 'inboxLink']) {
          await t.test(
            `${replayPath} replay detects persisted ${conflictKind} conflicts despite a matching inbox`,
            async () => {
              const sourceEventId = randomUUID();
              fixRoundSourceEventIds.add(sourceEventId);
              const wrongInboxEventId =
                conflictKind === 'inboxLink' ? randomUUID() : undefined;
              if (wrongInboxEventId)
                fixRoundSourceEventIds.add(wrongInboxEventId);
              const executionId = randomUUID();
              const userId = randomUUID();
              const existing = await seedReadInbox(repo, {
                sourceEventId,
                userId,
                executionId,
              });
              const delivery = await seedDelivery(repo, {
                sourceEventId,
                userId,
                executionId:
                  conflictKind === 'executionId' ? randomUUID() : executionId,
                eventType:
                  conflictKind === 'eventType'
                    ? 'workflow.failed'
                    : 'workflow.completed',
              });
              let wrongInbox;
              if (conflictKind === 'inboxLink') {
                wrongInbox = await seedInbox(repo, {
                  sourceEventId: wrongInboxEventId,
                  userId,
                });
                await deliveryRepo.client.notificationDelivery.update({
                  where: { id: delivery.id },
                  data: { inboxId: wrongInbox.id },
                });
              }
              const beforeDelivery =
                await deliveryRepo.client.notificationDelivery.findUnique({
                  where: { id: delivery.id },
                });
              const incoming =
                replayPath === 'legacy'
                  ? legacyEvent({
                      eventId: sourceEventId,
                      aggregateId: executionId,
                      payload: { userId, executionId },
                    })
                  : v2Event([userId], {
                      eventId: sourceEventId,
                      entity: { kind: 'EXECUTION', id: executionId },
                    });

              await assert.rejects(
                replayPath === 'legacy'
                  ? service.consume(incoming)
                  : repo.ingest(incoming),
                (error) =>
                  error && error.name === 'InboxPersistenceConflictError',
              );
              assert.deepEqual(
                await deliveryRepo.client.notificationDelivery.findUnique({
                  where: { id: delivery.id },
                }),
                beforeDelivery,
              );
              assert.deepEqual(
                await repo.client.notificationInbox.findUnique({
                  where: { id: existing.id },
                }),
                existing,
              );
              assert.equal(
                await repo.client.notificationInbox.count({
                  where: { sourceEventId },
                }),
                1,
              );
              if (wrongInbox)
                assert.equal(
                  (
                    await deliveryRepo.client.notificationDelivery.findUnique({
                      where: { id: delivery.id },
                    })
                  ).inboxId,
                  wrongInbox.id,
                );
            },
          );
        }
      }

      await t.test(
        'a matching inbox cannot hide a stored conflict from sanitized DLQ-before-ACK handling',
        async () => {
          const sourceEventId = randomUUID();
          const executionId = randomUUID();
          const userId = randomUUID();
          const existing = await seedReadInbox(repo, {
            sourceEventId,
            userId,
            executionId,
          });
          const privateDestination = 'must-not-leak-private-destination';
          const delivery = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
            eventType: 'workflow.failed',
            destination: privateDestination,
          });
          const event = legacyEvent({
            eventId: sourceEventId,
            aggregateId: executionId,
            payload: {
              userId,
              executionId,
              recipients: [
                { provider: 'TELEGRAM', destination: privateDestination },
              ],
            },
          });
          const ordering = [];
          const consumer = new RabbitConsumer(
            service,
            testSettings(databaseName),
          );
          await consumer.handle(
            {
              content: Buffer.from(JSON.stringify(event)),
              fields: { routingKey: event.eventType },
            },
            {
              nack: (_message, _all, requeue) =>
                ordering.push(requeue ? 'requeued' : 'dead-lettered'),
              ack: () => ordering.push('acknowledged'),
            },
          );
          // The broker dead-letters the original message (body kept for replay).
          assert.deepEqual(ordering, ['dead-lettered']);
          assert.deepEqual(
            await repo.client.notificationInbox.findUnique({
              where: { id: existing.id },
            }),
            existing,
          );
          assert.equal(
            (
              await deliveryRepo.client.notificationDelivery.findUnique({
                where: { id: delivery.id },
              })
            ).inboxId,
            null,
          );
        },
      );

      await t.test(
        'failure midway through stored-group repair rolls back, stays unacked, and retry repairs once',
        async () => {
          const sourceEventId = randomUUID();
          const executionId = randomUUID();
          const inboxUser = randomUUID();
          const storedOnlyUser = randomUUID();
          const replayOnlyUser = randomUUID();
          const existing = await seedReadInbox(repo, {
            sourceEventId,
            userId: inboxUser,
            executionId,
          });
          const first = await seedDelivery(repo, {
            sourceEventId,
            userId: inboxUser,
            executionId,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          });
          const second = await seedDelivery(repo, {
            sourceEventId,
            userId: storedOnlyUser,
            executionId,
            createdAt: new Date('2024-01-02T00:00:00.000Z'),
          });
          const before = new Map(
            [first, second].map((row) => [row.id, legacyFields(row)]),
          );
          const event = v2Event([inboxUser, replayOnlyUser], {
            eventId: sourceEventId,
            entity: { kind: 'EXECUTION', id: executionId },
          });
          const message = {
            content: Buffer.from(JSON.stringify(event)),
            fields: { routingKey: event.eventType },
          };
          const acknowledgements = [];
          const consumer = new RabbitConsumer(
            service,
            testSettings(databaseName),
          );
          const requeues = [];
          const channel = {
            ack: (incoming) => acknowledgements.push(incoming),
            reject: (_m, requeue) => requeues.push(requeue),
          };
          consumer.sleep = () => Promise.resolve();
          await deliveryRepo.client.$executeRawUnsafe(`
            CREATE FUNCTION notification.task3_fix01_fail_inbox_insert() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN
              RAISE EXCEPTION 'task3 fix01 injected inbox failure';
            END $$
          `);
          await deliveryRepo.client.$executeRawUnsafe(`
            CREATE TRIGGER task3_fix01_fail_inbox_insert
            BEFORE INSERT ON notification.notification_inbox
            FOR EACH ROW EXECUTE FUNCTION notification.task3_fix01_fail_inbox_insert()
          `);
          try {
            await consumer.handle(message, channel);
            assert.deepEqual(requeues, [true]);
            assert.equal(acknowledgements.length, 0);
            assert.deepEqual(
              await repo.client.notificationInbox.findUnique({
                where: { id: existing.id },
              }),
              existing,
            );
            assert.equal(
              await repo.client.notificationInbox.count({
                where: { sourceEventId },
              }),
              1,
            );
            const rolledBack =
              await deliveryRepo.client.notificationDelivery.findMany({
                where: { sourceEventId },
              });
            assert(rolledBack.every((row) => row.inboxId === null));
            for (const row of rolledBack)
              assert.deepEqual(legacyFields(row), before.get(row.id));
          } finally {
            await deliveryRepo.client.$executeRawUnsafe(
              'DROP TRIGGER IF EXISTS task3_fix01_fail_inbox_insert ON notification.notification_inbox',
            );
            await deliveryRepo.client.$executeRawUnsafe(
              'DROP FUNCTION IF EXISTS notification.task3_fix01_fail_inbox_insert()',
            );
          }

          await consumer.handle(message, channel);
          assert.equal(acknowledgements.length, 1);
          const inboxItems = await repo.client.notificationInbox.findMany({
            where: { sourceEventId },
          });
          assert.deepEqual(
            inboxItems.map((item) => item.userId).sort(),
            [inboxUser, storedOnlyUser].sort(),
          );
          const deliveries =
            await deliveryRepo.client.notificationDelivery.findMany({
              where: { sourceEventId },
            });
          assert.equal(deliveries.length, 2);
          for (const delivery of deliveries) {
            assert.deepEqual(legacyFields(delivery), before.get(delivery.id));
            assert.equal(
              delivery.inboxId,
              inboxItems.find((item) => item.userId === delivery.userId).id,
            );
          }
        },
      );

      await t.test(
        'legacy delivery and inbox commit roll back together and only then ack',
        async () => {
          const event = legacyEvent();
          const consumer = new RabbitConsumer(
            service,
            testSettings(databaseName),
          );
          const acknowledgements = [];
          const requeues = [];
          const channel = {
            ack: (message) => acknowledgements.push(message),
            reject: (_m, requeue) => requeues.push(requeue),
          };
          consumer.sleep = () => Promise.resolve();
          const message = {
            content: Buffer.from(JSON.stringify(event)),
            fields: { routingKey: event.eventType },
          };
          await deliveryRepo.client.$executeRawUnsafe(`
            CREATE FUNCTION notification.task3_fail_inbox_insert() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN
              RAISE EXCEPTION 'task3 injected inbox failure';
            END $$
          `);
          await deliveryRepo.client.$executeRawUnsafe(`
            CREATE TRIGGER task3_fail_inbox_insert
            BEFORE INSERT ON notification.notification_inbox
            FOR EACH ROW EXECUTE FUNCTION notification.task3_fail_inbox_insert()
          `);
          try {
            await consumer.handle(message, channel);
            assert.deepEqual(requeues, [true]);
            assert.equal(acknowledgements.length, 0);
            assert.equal(
              await deliveryRepo.client.notificationDelivery.count({
                where: { sourceEventId: event.eventId },
              }),
              0,
            );
            assert.equal(
              await repo.client.notificationInbox.count({
                where: { sourceEventId: event.eventId },
              }),
              0,
            );
          } finally {
            await deliveryRepo.client.$executeRawUnsafe(
              'DROP TRIGGER IF EXISTS task3_fail_inbox_insert ON notification.notification_inbox',
            );
            await deliveryRepo.client.$executeRawUnsafe(
              'DROP FUNCTION IF EXISTS notification.task3_fail_inbox_insert()',
            );
          }
          await consumer.handle(message, channel);
          assert.equal(acknowledgements.length, 1);
          const rows = await deliveryRepo.client.notificationDelivery.findMany({
            where: { sourceEventId: event.eventId },
          });
          assert.equal(rows.length, 2);
          assert(rows.every((row) => row.inboxId !== null));
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId: event.eventId },
            }),
            1,
          );
          await deliveryRepo.client.notificationDelivery.deleteMany({
            where: { sourceEventId: event.eventId },
          });
          await repo.client.notificationInbox.deleteMany({
            where: { sourceEventId: event.eventId },
          });
        },
      );

      await t.test(
        'v2 ingest is atomic, canonical, replay-safe and delivery-free',
        async () => {
          const recipientA = randomUUID();
          const recipientB = randomUUID();
          const event = v2Event([recipientA, recipientB]);
          await Promise.all(
            Array.from({ length: 8 }, () => repo.ingest(event)),
          );
          const initial = await repo.client.notificationInbox.findMany({
            where: { sourceEventId: event.eventId },
          });
          assert.equal(initial.length, 2);
          assert.deepEqual(
            initial.map((item) => item.userId).sort(),
            [recipientA, recipientB].sort(),
          );
          assert.equal(
            await repo.client.notificationDelivery.count({
              where: { sourceEventId: event.eventId },
            }),
            0,
          );
          const beforeReplay = initial.find(
            (item) => item.userId === recipientA,
          );

          await repo.onModuleDestroy();
          repo = new PrismaInboxRepository(testSettings(databaseName));
          await repo.ingest({
            ...event,
            eventId: event.eventId.toUpperCase(),
            recipientUserIds: [recipientA.toUpperCase(), randomUUID()],
            data: { ...event.data, workflowName: 'Changed on replay' },
          });
          const afterReplay = await repo.client.notificationInbox.findMany({
            where: { sourceEventId: event.eventId },
          });
          assert.equal(afterReplay.length, 3); // NT-6: replay adds the new recipient only
          assert.equal(
            afterReplay.find((item) => item.userId === recipientA).id,
            beforeReplay.id,
          );
          assert.equal(
            afterReplay.find((item) => item.userId === recipientA).content.vi
              .message,
            beforeReplay.content.vi.message,
          );

          const caseVariantUser = randomUUID();
          const caseVariantEvent = v2Event([
            caseVariantUser,
            caseVariantUser.toUpperCase(),
          ]);
          await repo.ingest(caseVariantEvent);
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId: caseVariantEvent.eventId },
            }),
            1,
          );

          const beforeMalformed = await repo.client.notificationInbox.count();
          await assert.rejects(
            repo.ingest({ ...event, eventType: 'workflow.unknown' }),
          );
          assert.equal(
            await repo.client.notificationInbox.count(),
            beforeMalformed,
          );
        },
      );

      await t.test(
        'v2 multi-recipient failure leaves no partial inbox rows',
        async () => {
          const eventId = randomUUID();
          const firstUser = randomUUID();
          const secondUser = randomUUID();
          const conflictingKey = inboxDedupKey(secondUser, eventId);
          await repo.client.notificationInbox.create({
            data: {
              id: inboxIdForKey(conflictingKey),
              dedupKey: `fixture-conflict:${randomUUID()}`,
              sourceEventId: randomUUID(),
              userId: secondUser,
              eventType: 'workflow.completed',
              category: 'WORKFLOW',
              severity: 'SUCCESS',
              workspaceId: null,
              actorUserId: null,
              executionId: null,
              content: inboxContent('WORKFLOW', 'SUCCESS'),
              occurredAt: new Date(),
            },
          });
          await assert.rejects(
            repo.ingest(v2Event([firstUser, secondUser], { eventId })),
          );
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId: eventId },
            }),
            0,
          );
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { userId: firstUser },
            }),
            0,
          );
        },
      );

      await t.test(
        'list/count/read operations are user-scoped and fence no delivery leases',
        async () => {
          const userId = randomUUID();
          const otherUserId = randomUUID();
          const instant = new Date('2025-04-05T06:07:08.009Z');
          const items = [];
          for (let index = 0; index < 4; index++)
            items.push(
              await seedInbox(repo, {
                userId,
                category: index < 2 ? 'WORKSPACE' : 'WORKFLOW',
                severity: index === 1 ? 'SUCCESS' : 'INFO',
                createdAt: instant,
                occurredAt: instant,
                readAt:
                  index === 2 ? new Date('2025-04-06T00:00:00.000Z') : null,
              }),
            );
          const foreign = await seedInbox(repo, {
            userId: otherUserId,
            createdAt: instant,
          });
          const delivery = await seedDelivery(repo, { userId });
          const crossUserDelivery = await seedDelivery(repo, {
            userId: otherUserId,
          });
          await repo.client.notificationDelivery.update({
            where: { id: delivery.id },
            data: { inboxId: items[0].id },
          });
          await assert.rejects(
            repo.client.notificationDelivery.update({
              where: { id: crossUserDelivery.id },
              data: { inboxId: items[0].id },
            }),
          );
          assert.equal(
            (
              await repo.client.notificationDelivery.findUnique({
                where: { id: crossUserDelivery.id },
              })
            ).inboxId,
            null,
          );
          const deliveryBeforeRead =
            await repo.client.notificationDelivery.findUnique({
              where: { id: delivery.id },
            });

          const firstPage = await repo.list(userId, { limit: 2 });
          assert.equal(firstPage.length, 3);
          const secondPage = await repo.list(userId, {
            limit: 2,
            cursor: {
              id: firstPage[1].id,
              createdAt: firstPage[1].createdAt,
            },
          });
          assert.equal(secondPage.length, 2);
          const pageIds = [
            ...firstPage.slice(0, 2).map((item) => item.id),
            ...secondPage.map((item) => item.id),
          ];
          const expectedIds = items
            .map((item) => item.id)
            .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
          assert.deepEqual(pageIds, expectedIds);
          assert.equal(new Set(pageIds).size, 4);
          assert.deepEqual(
            (
              await repo.list(userId, {
                limit: 10,
                unreadOnly: true,
                category: 'WORKSPACE',
              })
            )
              .map((item) => item.id)
              .sort(),
            items
              .slice(0, 2)
              .map((item) => item.id)
              .sort(),
          );
          assert.equal((await repo.list(otherUserId, { limit: 10 })).length, 1);
          assert.equal(await repo.unreadCount(userId), 3);
          assert.equal(await repo.unreadCount(otherUserId), 1);
          assert.equal(await repo.markRead(otherUserId, items[0].id), null);

          const marked = await repo.markRead(userId, items[0].id);
          const markedAgain = await repo.markRead(userId, items[0].id);
          assert(marked.readAt instanceof Date);
          assert.equal(markedAgain.readAt.getTime(), marked.readAt.getTime());
          assert.equal(await repo.markAllRead(userId), 2);
          assert.equal(await repo.markAllRead(userId), 0);
          const deliveryAfterRead =
            await repo.client.notificationDelivery.findUnique({
              where: { id: delivery.id },
            });
          // v2 read writes through to the linked delivery (NT-4) but never touches the lease fence.
          assert(deliveryAfterRead.readAt instanceof Date);
          assert.deepEqual(
            legacyFields({ ...deliveryAfterRead, readAt: null }),
            legacyFields(deliveryBeforeRead),
          );
          assert.equal(foreign.userId, otherUserId);
          await repo.client.notificationDelivery.delete({
            where: { id: crossUserDelivery.id },
          });
          await assert.rejects(repo.list(userId, { limit: 0 }));
          await assert.rejects(repo.list(userId, { limit: 101 }));
          await assert.rejects(repo.list(userId, { limit: 1.5 }));
        },
      );

      await t.test(
        'a re-emitted event adds only the missing recipient rows (NT-6)',
        async () => {
          const first = randomUUID();
          const second = randomUUID();
          const event = v2Event([first]);
          await repo.ingest(event);
          await repo.ingest({ ...event, recipientUserIds: [first, second] });
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId: event.eventId },
            }),
            2,
          );
          await repo.client.notificationInbox.deleteMany({
            where: { sourceEventId: event.eventId },
          });
        },
      );

      await t.test(
        'v1 and v2 read state write through to each other (NT-4)',
        async () => {
          const readStates = async (eventId) => ({
            deliveries: (
              await deliveryRepo.client.notificationDelivery.findMany({
                where: { sourceEventId: eventId },
              })
            ).map((row) => row.readAt !== null),
            inbox: (
              await repo.client.notificationInbox.findMany({
                where: { sourceEventId: eventId },
              })
            ).map((row) => row.readAt !== null),
          });
          const cleanup = async (eventId) => {
            await deliveryRepo.client.notificationDelivery.deleteMany({
              where: { sourceEventId: eventId },
            });
            await repo.client.notificationInbox.deleteMany({
              where: { sourceEventId: eventId },
            });
          };
          // v1 mark-read -> inbox row and sibling delivery
          const a = legacyEvent();
          await service.consume(a);
          const [delivery] =
            await deliveryRepo.client.notificationDelivery.findMany({
              where: { sourceEventId: a.eventId },
            });
          await deliveryRepo.markRead(a.payload.userId, delivery.id);
          assert.deepEqual(await readStates(a.eventId), {
            deliveries: [true, true],
            inbox: [true],
          });
          // v2 mark-read -> all linked deliveries
          const b = legacyEvent();
          await service.consume(b);
          const [item] = await repo.client.notificationInbox.findMany({
            where: { sourceEventId: b.eventId },
          });
          await repo.markRead(b.payload.userId, item.id);
          assert.deepEqual(await readStates(b.eventId), {
            deliveries: [true, true],
            inbox: [true],
          });
          // read-all in both directions
          const c = legacyEvent();
          const d = legacyEvent();
          await service.consume(c);
          await service.consume(d);
          await deliveryRepo.markAllRead(c.payload.userId);
          assert.deepEqual(await readStates(c.eventId), {
            deliveries: [true, true],
            inbox: [true],
          });
          assert.deepEqual(await readStates(d.eventId), {
            deliveries: [false, false],
            inbox: [false],
          });
          await repo.markAllRead(d.payload.userId);
          assert.deepEqual(await readStates(d.eventId), {
            deliveries: [true, true],
            inbox: [true],
          });
          for (const e of [a, b, c, d]) await cleanup(e.eventId);
        },
      );

      await t.test(
        'legacy groups aggregate oldest content and all-read timestamps without changing deliveries',
        async () => {
          const sourceEventId = randomUUID();
          const userId = randomUUID();
          const executionId = randomUUID();
          const workspaceId = randomUUID();
          const workflowId = randomUUID();
          const createdAt = new Date('2024-01-02T03:04:05.006Z');
          const latestReadAt = new Date('2024-03-04T05:06:07.008Z');
          const early = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
            workflowName: 'Trusted workflow name',
            workflowId,
            workspaceId,
            createdAt,
            readAt: new Date('2024-02-01T00:00:00.000Z'),
            provider: 'TELEGRAM',
          });
          const late = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
            workflowName: 'Later workflow name is not representative',
            workflowId: randomUUID(),
            workspaceId: randomUUID(),
            createdAt: new Date('2024-01-03T00:00:00.000Z'),
            readAt: latestReadAt,
            provider: 'EXPO_PUSH',
          });
          const before = await repo.client.notificationDelivery.findMany({
            where: { id: { in: [early.id, late.id] } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });

          const result = await repo.reconcileLegacy(1);
          assert.deepEqual(result, {
            scannedGroups: 1,
            createdItems: 1,
            linkedDeliveries: 2,
            skippedGroups: 0,
          });
          const item = await repo.client.notificationInbox.findUnique({
            where: { sourceEventId_userId: { sourceEventId, userId } },
          });
          assert(item);
          assert.equal(
            item.id,
            inboxIdForKey(inboxDedupKey(userId, sourceEventId)),
          );
          assert.equal(item.createdAt.getTime(), createdAt.getTime());
          assert.equal(item.occurredAt.getTime(), createdAt.getTime());
          assert.equal(item.readAt.getTime(), latestReadAt.getTime());
          assert.equal(item.executionId, executionId);
          assert.equal(item.workspaceId, workspaceId);
          assert.equal(item.actorUserId, null);
          assert.deepEqual(Object.keys(item.content).sort(), ['en', 'vi']);
          assert.equal(
            item.content.en.message.includes('Trusted workflow name'),
            true,
          );
          assert.deepEqual(item.content.en.target, {
            kind: 'EXECUTION',
            workspaceId,
            executionId,
          });
          assert.equal(
            JSON.stringify(item.content).includes('UNTRUSTED OLD'),
            false,
          );
          assert.equal(JSON.stringify(item.content).includes('private'), false);
          assert.equal(
            await repo.reconcileLegacy(1).then((value) => value.scannedGroups),
            0,
          );
          const after = await repo.client.notificationDelivery.findMany({
            where: { id: { in: [early.id, late.id] } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          assert.deepEqual(after.map(legacyFields), before.map(legacyFields));
          assert(after.every((delivery) => delivery.inboxId === item.id));

          const lateDelivery = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
            createdAt: new Date('2024-04-01T00:00:00.000Z'),
            readAt: null,
          });
          const lateResult = await repo.reconcileLegacy(1);
          assert.equal(lateResult.createdItems, 0);
          assert.equal(lateResult.linkedDeliveries, 1);
          const preserved = await repo.client.notificationInbox.findUnique({
            where: { id: item.id },
          });
          assert.equal(preserved.readAt.getTime(), latestReadAt.getTime());
          assert.equal(preserved.createdAt.getTime(), createdAt.getTime());
          assert.equal(preserved.content.en.message, item.content.en.message);
          assert.equal(
            (
              await repo.client.notificationDelivery.findUnique({
                where: { id: lateDelivery.id },
              })
            ).inboxId,
            item.id,
          );
        },
      );

      await t.test(
        'mixed reads, null events and same-event different users remain distinct',
        async () => {
          const sharedEventId = randomUUID();
          const userA = randomUUID();
          const userB = randomUUID();
          const executionId = randomUUID();
          const shared = await seedDelivery(repo, {
            sourceEventId: sharedEventId,
            userId: userA,
            executionId,
            readAt: new Date('2024-05-01T00:00:00.000Z'),
          });
          const sharedOtherUser = await seedDelivery(repo, {
            sourceEventId: sharedEventId,
            userId: userB,
            executionId,
            provider: 'EXPO_PUSH',
            readAt: new Date('2024-05-01T00:00:00.000Z'),
          });
          const mixedUnread = await seedDelivery(repo, {
            sourceEventId: sharedEventId,
            userId: userA,
            executionId,
            provider: 'EXPO_PUSH',
            readAt: null,
            createdAt: new Date('2024-01-02T00:00:00.000Z'),
          });
          const nullOne = await seedDelivery(repo, { userId: userA });
          const nullTwo = await seedDelivery(repo, { userId: userA });

          const result = await repo.reconcileLegacy(10);
          assert.equal(result.scannedGroups, 4);
          assert.equal(result.createdItems, 4);
          assert.equal(result.linkedDeliveries, 5);
          const eventItems = await repo.client.notificationInbox.findMany({
            where: { sourceEventId: sharedEventId },
          });
          assert.equal(eventItems.length, 2);
          assert.notEqual(
            eventItems.find((item) => item.userId === userA).id,
            eventItems.find((item) => item.userId === userB).id,
          );
          assert.equal(
            eventItems.find((item) => item.userId === userA).readAt,
            null,
          );
          const nullItems = await repo.client.notificationInbox.findMany({
            where: { sourceEventId: null, userId: userA },
          });
          assert.equal(nullItems.length, 2);
          assert.notEqual(nullItems[0].id, nullItems[1].id);
          assert.equal(
            nullItems.some(
              (item) =>
                item.dedupKey === inboxDedupKey(userA, null, nullOne.id),
            ),
            true,
          );
          assert.equal(
            nullItems.some(
              (item) =>
                item.dedupKey === inboxDedupKey(userA, null, nullTwo.id),
            ),
            true,
          );
          assert(shared && sharedOtherUser && mixedUnread);
        },
      );

      await t.test(
        'unsafe or missing legacy metadata uses generic bilingual copy and safe targets',
        async () => {
          const unsafeEvent = randomUUID();
          const unsafeUser = randomUUID();
          const retainedExecutionId = randomUUID();
          await seedDelivery(repo, {
            sourceEventId: unsafeEvent,
            userId: unsafeUser,
            executionId: retainedExecutionId,
            eventType: 'workflow.failed',
            payload: {
              workflowName: ' ',
              workflowId: 'not-a-uuid',
              workspaceId: 'private-invalid-id',
              error: 'DO NOT COPY THIS ERROR',
              title: 'DO NOT COPY THIS TITLE',
              message: 'DO NOT COPY THIS MESSAGE',
            },
          });
          const unnamedEvent = randomUUID();
          const unnamedUser = randomUUID();
          const workspaceId = randomUUID();
          const executionId = randomUUID();
          await seedDelivery(repo, {
            sourceEventId: unnamedEvent,
            userId: unnamedUser,
            executionId,
            workspaceId,
            eventType: 'workflow.completed',
            payload: {
              workflowName: '',
              workflowId: randomUUID(),
              workspaceId,
            },
          });

          const result = await repo.reconcileLegacy(10);
          assert.equal(result.createdItems, 2);
          const unsafe = await repo.client.notificationInbox.findUnique({
            where: {
              sourceEventId_userId: {
                sourceEventId: unsafeEvent,
                userId: unsafeUser,
              },
            },
          });
          assert.equal(unsafe.executionId, retainedExecutionId);
          assert.equal(unsafe.workspaceId, null);
          assert.deepEqual(unsafe.content.en.target, { kind: 'NONE' });
          assert.equal(unsafe.content.en.severity, 'ERROR');
          assert.equal(
            unsafe.content.en.message,
            'Workflow failed. Open the execution for details.',
          );
          assert.equal(
            JSON.stringify(unsafe.content).includes('DO NOT COPY'),
            false,
          );
          assert.equal(
            JSON.stringify(unsafe.content).includes('private-invalid-id'),
            false,
          );

          const unnamed = await repo.client.notificationInbox.findUnique({
            where: {
              sourceEventId_userId: {
                sourceEventId: unnamedEvent,
                userId: unnamedUser,
              },
            },
          });
          assert.equal(unnamed.workspaceId, workspaceId);
          assert.equal(unnamed.executionId, executionId);
          assert.deepEqual(unnamed.content.en.target, {
            kind: 'EXECUTION',
            workspaceId,
            executionId,
          });
          assert.equal(
            unnamed.content.en.message,
            'Workflow completed successfully.',
          );
        },
      );

      await t.test(
        'v2 inbox read state and identity survive late legacy reconciliation',
        async () => {
          const userId = randomUUID();
          const event = v2Event([userId]);
          await repo.ingest(event);
          const item = await repo.client.notificationInbox.findUnique({
            where: {
              sourceEventId_userId: { sourceEventId: event.eventId, userId },
            },
          });
          const readAt = new Date('2026-01-02T03:04:05.006Z');
          await repo.client.notificationInbox.update({
            where: { id: item.id },
            data: { readAt },
          });
          const delivery = await seedDelivery(repo, {
            sourceEventId: event.eventId,
            userId,
            executionId: event.entity.id,
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
            readAt: null,
          });
          const identity = inboxIdForKey(inboxDedupKey(userId, event.eventId));
          const result = await repo.reconcileLegacy(1);
          assert.equal(result.createdItems, 0);
          assert.equal(result.linkedDeliveries, 1);
          const after = await repo.client.notificationInbox.findUnique({
            where: { id: item.id },
          });
          assert.equal(after.id, identity);
          assert.equal(after.readAt.getTime(), readAt.getTime());
          assert.equal(after.createdAt.getTime(), item.createdAt.getTime());
          assert.deepEqual(after.content, item.content);
          assert.equal(
            (
              await repo.client.notificationDelivery.findUnique({
                where: { id: delivery.id },
              })
            ).inboxId,
            item.id,
          );
        },
      );

      await t.test(
        'reconciliation batches are bounded and stable under concurrent callers',
        async () => {
          const groups = [];
          for (let index = 0; index < 3; index++)
            groups.push(
              await seedDelivery(repo, {
                sourceEventId: randomUUID(),
                userId: randomUUID(),
                createdAt: new Date(`2025-06-0${index + 1}T00:00:00.000Z`),
              }),
            );
          const firstBatch = await repo.reconcileLegacy(2);
          assert.equal(firstBatch.scannedGroups, 2);
          assert.equal(firstBatch.linkedDeliveries, 2);
          assert.equal(
            await repo.client.notificationInbox.count({
              where: {
                sourceEventId: {
                  in: groups.slice(0, 2).map((row) => row.sourceEventId),
                },
              },
            }),
            2,
          );
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId: groups[2].sourceEventId },
            }),
            0,
          );
          const secondBatch = await repo.reconcileLegacy(2);
          assert.equal(secondBatch.scannedGroups, 1);
          assert.equal(secondBatch.linkedDeliveries, 1);
          const concurrentGroup = await seedDelivery(repo, {
            sourceEventId: randomUUID(),
            userId: randomUUID(),
          });
          const concurrent = await Promise.all([
            repo.reconcileLegacy(10),
            repo.reconcileLegacy(10),
          ]);
          assert.equal(
            concurrent.reduce(
              (total, value) => total + value.linkedDeliveries,
              0,
            ),
            1,
          );
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId: concurrentGroup.sourceEventId },
            }),
            1,
          );
          for (const invalid of [0, 1001, 1.5])
            await assert.rejects(repo.reconcileLegacy(invalid));
          assert.equal(groups.length, 3);
        },
      );

      await t.test(
        'unsupported or conflicting legacy groups stay untouched and are reported',
        async () => {
          const unsupportedEvent = randomUUID();
          const unsupported = await seedDelivery(repo, {
            sourceEventId: unsupportedEvent,
            userId: randomUUID(),
            eventType: 'workspace.created',
          });
          const conflictEvent = randomUUID();
          const conflictUser = randomUUID();
          const first = await seedDelivery(repo, {
            sourceEventId: conflictEvent,
            userId: conflictUser,
            executionId: randomUUID(),
          });
          const second = await seedDelivery(repo, {
            sourceEventId: conflictEvent,
            userId: conflictUser,
            executionId: randomUUID(),
            eventType: 'workflow.failed',
            provider: 'EXPO_PUSH',
          });
          const result = await repo.reconcileLegacy(10);
          assert.equal(result.skippedGroups, 2);
          const rows = await repo.client.notificationDelivery.findMany({
            where: { id: { in: [unsupported.id, first.id, second.id] } },
          });
          assert(rows.every((row) => row.inboxId === null));
          assert.equal(
            await repo.client.notificationInbox.count({
              where: {
                sourceEventId: { in: [unsupportedEvent, conflictEvent] },
              },
            }),
            0,
          );
        },
      );

      await t.test(
        'an inconsistent existing inbox link is skipped, never reassigned',
        async () => {
          const sourceEventId = randomUUID();
          const userId = randomUUID();
          const executionId = randomUUID();
          const first = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
            createdAt: new Date('2023-01-01T00:00:00.000Z'),
          });
          const second = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
            provider: 'EXPO_PUSH',
          });
          const wrongItem = await seedInbox(repo, { userId });
          await repo.client.notificationDelivery.update({
            where: { id: first.id },
            data: { inboxId: wrongItem.id },
          });
          const before = await repo.client.notificationDelivery.findMany({
            where: { id: { in: [first.id, second.id] } },
          });
          const result = await repo.reconcileLegacy(1);
          assert.equal(result.skippedGroups, 1);
          const after = await repo.client.notificationDelivery.findMany({
            where: { id: { in: [first.id, second.id] } },
          });
          assert.deepEqual(
            after.map((row) => row.inboxId),
            before.map((row) => row.inboxId),
          );
          assert.equal(
            await repo.client.notificationInbox.count({
              where: { sourceEventId, userId },
            }),
            0,
          );
        },
      );

      await t.test(
        'a failed link statement rolls back the new inbox and every link',
        async () => {
          const sourceEventId = randomUUID();
          const userId = randomUUID();
          const executionId = randomUUID();
          const first = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
          });
          const second = await seedDelivery(repo, {
            sourceEventId,
            userId,
            executionId,
            provider: 'EXPO_PUSH',
          });
          await repo.client.$executeRawUnsafe(`
          CREATE FUNCTION notification.test_fail_inbox_link() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.inbox_id IS NOT NULL THEN
              RAISE EXCEPTION 'test-only inbox link failure';
            END IF;
            RETURN NEW;
          END $$
        `);
          await repo.client.$executeRawUnsafe(`
          CREATE TRIGGER test_fail_inbox_link
          BEFORE UPDATE OF inbox_id ON notification.notification_deliveries
          FOR EACH ROW EXECUTE FUNCTION notification.test_fail_inbox_link()
        `);
          try {
            await assert.rejects(repo.reconcileLegacy(100));
            assert.equal(
              await repo.client.notificationInbox.count({
                where: { sourceEventId, userId },
              }),
              0,
            );
            const unchanged = await repo.client.notificationDelivery.findMany({
              where: { id: { in: [first.id, second.id] } },
            });
            assert(unchanged.every((row) => row.inboxId === null));
          } finally {
            await repo.client.$executeRawUnsafe(
              'DROP TRIGGER IF EXISTS test_fail_inbox_link ON notification.notification_deliveries',
            );
            await repo.client.$executeRawUnsafe(
              'DROP FUNCTION IF EXISTS notification.test_fail_inbox_link()',
            );
          }
        },
      );

      await t.test(
        'operator --apply performs exactly one bounded batch and prints counts only',
        async () => {
          const delivery = await seedDelivery(repo, {
            sourceEventId: randomUUID(),
            userId: randomUUID(),
            createdAt: new Date('2022-01-01T00:00:00.000Z'),
          });
          const result = spawnSync(
            process.execPath,
            [
              join(repositoryRoot, 'scripts/reconcile-inbox.cjs'),
              '--apply',
              '--batch-size',
              '1',
            ],
            {
              cwd: repositoryRoot,
              timeout: 30000,
              encoding: 'utf8',
              windowsHide: true,
              env: {
                ...process.env,
                DB_HOST: '127.0.0.1',
                DB_PORT: '15439',
                DB_NAME: databaseName,
                DB_USERNAME: 'notification_test',
                DB_PASSWORD: 'unused-local-trust',
                DB_SSL_MODE: 'disable',
                JWT_ACCESS_SECRET: 'test-only-key-not-for-production-123456',
                RABBITMQ_USERNAME: 'guest',
                RABBITMQ_PASSWORD: 'guest',
              },
            },
          );
          assert.equal(result.status, 0, 'Explicit operator batch failed');
          const counts = JSON.parse(result.stdout);
          assert.deepEqual(counts, {
            scannedGroups: 1,
            createdItems: 1,
            linkedDeliveries: 1,
            skippedGroups: 0,
          });
          assert.equal(result.stdout.trim(), JSON.stringify(counts));
          assert.equal(
            (
              await repo.client.notificationDelivery.findUnique({
                where: { id: delivery.id },
              })
            ).inboxId,
            inboxIdForKey(
              inboxDedupKey(delivery.userId, delivery.sourceEventId),
            ),
          );
        },
      );
    } finally {
      if (repo) await repo.onModuleDestroy().catch(() => {});
      if (deliveryRepo) await deliveryRepo.onModuleDestroy().catch(() => {});
      if (createdDatabase) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
