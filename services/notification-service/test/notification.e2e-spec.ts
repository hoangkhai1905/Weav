import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { sign } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { SETTINGS } from '../src/config/settings';
import { DeliveryRepository } from '../src/domain/notification';
import { InboxRepository } from '../src/domain/inbox';
import { DeliveryWorker } from '../src/application/delivery.worker';
import { RabbitConsumer } from '../src/infrastructure/rabbit.consumer';
import {
  mockRepository,
  testDelivery,
  testSettings,
} from '../src/testing/fixtures';

describe('notification HTTP (real Nest + Fastify)', () => {
  let app: NestFastifyApplication;
  const repo = mockRepository();
  const inboxRepository = {
    ingest: jest.fn(),
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    ready: jest.fn(),
    reconcileLegacy: jest.fn(),
  };
  const settings = testSettings();
  const userId = randomUUID();
  const rabbit = { isReady: true };
  function token(extra: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return sign(
      {
        sub: userId,
        sid: randomUUID(),
        jti: randomUUID(),
        token_use: 'access',
        user_status: 'ACTIVE',
        system_role: 'USER',
        iat: now,
        nbf: now,
        exp: now + 3600,
        ...extra,
      },
      settings.JWT_ACCESS_SECRET,
      {
        algorithm: 'HS256',
        issuer: settings.JWT_ISSUER,
        audience: settings.JWT_AUDIENCE,
      },
    );
  }
  const headers = () => ({ authorization: `Bearer ${token()}` });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SETTINGS)
      .useValue(settings)
      .overrideProvider(DeliveryRepository)
      .useValue(repo)
      .overrideProvider(InboxRepository)
      .useValue(inboxRepository)
      .overrideProvider(RabbitConsumer)
      .useValue(rabbit)
      .overrideProvider(DeliveryWorker)
      .useValue({})
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    repo.ready.mockResolvedValue(true);
    inboxRepository.ready.mockResolvedValue(true);
    rabbit.isReady = true;
  });
  it.each(['/api/v1/notifications', '/api/notifications'])(
    'serves %s and ignores forged user headers',
    async (url) => {
      const row = testDelivery();
      row.userId = userId;
      repo.list.mockResolvedValue([row]);
      const response = await app.inject({
        url,
        headers: { ...headers(), 'x-user-id': randomUUID() },
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json<{ items: { read: boolean }[] }>().items[0].read,
      ).toBe(false);
      expect(repo.list).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ limit: 20, unreadOnly: false }),
      );
      expect(response.body).not.toContain('destination');
    },
  );
  it.each([
    { token_use: 'refresh' },
    { user_status: 'DISABLED' },
    { exp: 1 },
    { sid: 'bad' },
    { iat: 9999999999 },
  ])('rejects invalid claims %j', async (claims) => {
    expect(
      (
        await app.inject({
          url: '/api/notifications',
          headers: { authorization: `Bearer ${token(claims)}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(repo.list).not.toHaveBeenCalled();
  });
  it('rejects unsigned requests, invalid signatures, and query injection', async () => {
    expect((await app.inject('/api/notifications')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/notifications',
          headers: { authorization: 'Bearer abc.def.ghi' },
        })
      ).statusCode,
    ).toBe(401);
    for (const query of [
      'limit=101',
      'unreadOnly=0',
      'cursor=garbage',
      'userId=someone',
      'status=UNKNOWN',
    ])
      expect(
        (
          await app.inject({
            url: `/api/notifications?${query}`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(400);
  });
  it('returns 404 for another user and marks owned rows', async () => {
    repo.markRead.mockResolvedValue(null);
    const id = randomUUID();
    const request = {
      method: 'PATCH' as const,
      url: `/api/notifications/${id}/read`,
      headers: headers(),
    };
    expect((await app.inject(request)).statusCode).toBe(404);
    expect(repo.markRead).toHaveBeenCalledWith(userId, id);
    const row = testDelivery();
    row.readAt = new Date();
    repo.markRead.mockResolvedValue(row);
    expect(
      (await app.inject(request)).json<{ item: { read: boolean } }>().item.read,
    ).toBe(true);
  });
  it('exposes count and read-all', async () => {
    repo.unreadCount.mockResolvedValue(3);
    repo.markAllRead.mockResolvedValue(3);
    expect(
      (
        await app.inject({
          url: '/api/v1/notifications/unread-count',
          headers: headers(),
        })
      ).json(),
    ).toEqual({ count: 3 });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/notifications/read-all',
          headers: headers(),
        })
      ).json(),
    ).toEqual({ updatedCount: 3 });
    expect(repo.markAllRead).toHaveBeenCalledWith(userId);
  });
  it('serves a strict localized v2 inbox view with a cursor from the last returned row', async () => {
    const workspaceId = randomUUID();
    const first = {
      id: randomUUID(),
      dedupKey: `event:${randomUUID()}:user:${userId}`,
      sourceEventId: randomUUID(),
      userId,
      actorUserId: randomUUID(),
      eventType: 'workspace.renamed',
      category: 'WORKSPACE' as const,
      severity: 'INFO' as const,
      workspaceId,
      executionId: null,
      content: {
        vi: {
          category: 'WORKSPACE' as const,
          severity: 'INFO' as const,
          title: 'Đã đổi tên',
          message: 'Tên đã được đổi.',
          target: { kind: 'WORKSPACE' as const, workspaceId },
        },
        en: {
          category: 'WORKSPACE' as const,
          severity: 'INFO' as const,
          title: 'Workspace renamed',
          message: 'The workspace name changed.',
          target: { kind: 'WORKSPACE' as const, workspaceId },
          destination: 'private-destination',
        },
      },
      occurredAt: new Date('2026-09-27T04:00:00.000Z'),
      createdAt: new Date('2026-09-27T04:01:00.000Z'),
      readAt: null,
    };
    const second = { ...first, id: randomUUID() };
    inboxRepository.list.mockResolvedValue([first, second]);

    const response = await app.inject({
      url: '/api/v2/notifications?limit=1&unreadOnly=true&category=WORKSPACE&locale=en',
      headers: { ...headers(), 'x-user-id': randomUUID() },
    });

    expect(response.statusCode).toBe(200);
    expect(inboxRepository.list).toHaveBeenCalledWith(userId, {
      limit: 1,
      unreadOnly: true,
      category: 'WORKSPACE',
    });
    const body = response.json<{
      items: Record<string, unknown>[];
      nextCursor: string | null;
    }>();
    expect(body.items[0]).toEqual({
      id: first.id,
      eventType: first.eventType,
      category: 'WORKSPACE',
      severity: 'INFO',
      title: 'Workspace renamed',
      message: 'The workspace name changed.',
      target: { kind: 'WORKSPACE', workspaceId },
      workspaceId,
      executionId: null,
      occurredAt: first.occurredAt.toISOString(),
      createdAt: first.createdAt.toISOString(),
      readAt: null,
    });
    expect(Object.keys(body.items[0]).sort()).toEqual(
      [
        'id',
        'eventType',
        'category',
        'severity',
        'title',
        'message',
        'target',
        'workspaceId',
        'executionId',
        'occurredAt',
        'createdAt',
        'readAt',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toContain('destination');
    expect(JSON.stringify(body)).not.toContain('sourceEventId');
    expect(
      JSON.parse(Buffer.from(body.nextCursor!, 'base64url').toString()),
    ).toEqual({
      id: first.id,
      createdAt: first.createdAt.toISOString(),
    });
  });
  it('rejects repeated, unknown, invalid and oversized v2 query values', async () => {
    for (const query of [
      'limit=1&limit=2',
      'limit=0',
      'limit=101',
      'limit=1.5',
      'unreadOnly=1',
      'category=UNKNOWN',
      'locale=fr',
      'userId=someone',
      `cursor=${'a'.repeat(513)}`,
    ]) {
      const response = await app.inject({
        url: `/api/v2/notifications?${query}`,
        headers: headers(),
      });
      expect(response.statusCode).toBe(400);
    }
    expect(inboxRepository.list).not.toHaveBeenCalled();
  });
  it('scopes v2 read, read-all and unread count to the JWT subject', async () => {
    const itemId = randomUUID();
    inboxRepository.unreadCount.mockResolvedValue(4);
    inboxRepository.markRead.mockResolvedValue(null);
    inboxRepository.markAllRead.mockResolvedValue(3);

    expect(
      (
        await app.inject({
          url: '/api/v2/notifications/unread-count',
          headers: headers(),
        })
      ).json(),
    ).toEqual({ count: 4 });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v2/notifications/${itemId}/read?locale=en`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
    expect(inboxRepository.markRead).toHaveBeenCalledWith(userId, itemId);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v2/notifications/read-all',
          headers: headers(),
        })
      ).json(),
    ).toEqual({ updatedCount: 3 });
    expect(inboxRepository.markAllRead).toHaveBeenCalledWith(userId);
    expect(
      (
        await app.inject({
          url: '/api/v2/notifications/unread-count?userId=forged',
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: '/api/v2/notifications/unread-count',
        })
      ).statusCode,
    ).toBe(401);
  });
  it('reports readiness separately and sanitizes failures', async () => {
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/ready')).statusCode).toBe(200);
    inboxRepository.ready.mockResolvedValue(false);
    expect((await app.inject('/ready')).statusCode).toBe(503);
    inboxRepository.ready.mockResolvedValue(true);
    rabbit.isReady = false;
    expect((await app.inject('/ready')).statusCode).toBe(503);
    repo.list.mockRejectedValue(new Error('postgres://private-password'));
    const response = await app.inject({
      url: '/api/notifications',
      headers: headers(),
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private-password');
  });
});
