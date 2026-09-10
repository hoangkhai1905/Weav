import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { NotificationsModule } from './notifications.module';

describe('notification gateway routes', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [NotificationsModule],
    })
      .useMocker((token) =>
        token === ConfigService
          ? { get: () => 'http://notification.internal:3000' }
          : undefined,
      )
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());
  it.each(['/api/notifications', '/api/v1/notifications'])(
    'forwards %s with only the bearer token',
    async (prefix) => {
      const request = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ items: [], nextCursor: null })),
        );
      const response = await app.inject({
        url: `${prefix}?limit=4&unreadOnly=true`,
        headers: {
          authorization: 'Bearer opaque-token',
          'x-user-id': 'forged',
          cookie: 'private',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(request).toHaveBeenCalledWith(
        'http://notification.internal:3000/api/v1/notifications?limit=4&unreadOnly=true',
        expect.objectContaining({
          headers: { authorization: 'Bearer opaque-token' },
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      );
    },
  );
  it.each([
    ['POST', '/read-all'],
    ['PATCH', '/00000000-0000-4000-8000-000000000001/read'],
    ['GET', '/unread-count'],
  ] as const)('proxies %s %s preserving status', async (method, suffix) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), {
        status: 404,
      }),
    );
    const response = await app.inject({
      method,
      url: `/api/notifications${suffix}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(404);
  });
  it('rejects requests without bearer auth before accessing the upstream', async () => {
    const request = jest.spyOn(globalThis, 'fetch');
    expect((await app.inject('/api/notifications')).statusCode).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
  it('sanitizes upstream failures', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private-url'));
    const response = await app.inject({
      url: '/api/notifications',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private-url');
  });
});
