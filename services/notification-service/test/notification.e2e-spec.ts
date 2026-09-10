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
  it('reports readiness separately and sanitizes failures', async () => {
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/ready')).statusCode).toBe(200);
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
