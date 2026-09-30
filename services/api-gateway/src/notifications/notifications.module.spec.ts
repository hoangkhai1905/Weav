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
    'forwards %s with only allowlisted headers',
    async (prefix) => {
      const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          headers: { 'content-type': 'application/json' },
        }),
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
          headers: expect.objectContaining({
            authorization: 'Bearer opaque-token',
            'x-request-id': expect.any(String) as unknown,
            'x-correlation-id': expect.any(String) as unknown,
          }) as unknown,
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
        headers: { 'content-type': 'application/json' },
      }),
    );
    const response = await app.inject({
      method,
      url: `/api/notifications${suffix}`,
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(404);
  });
  it.each([
    [
      'GET',
      '/api/v2/notifications?limit=7&unreadOnly=true&locale=en&category=WORKSPACE',
      'http://notification.internal:3000/api/v2/notifications?limit=7&unreadOnly=true&locale=en&category=WORKSPACE',
    ],
    [
      'GET',
      '/api/v2/notifications/unread-count?userId=forged',
      'http://notification.internal:3000/api/v2/notifications/unread-count?userId=forged',
    ],
    [
      'PATCH',
      '/api/v2/notifications/00000000-0000-4000-8000-000000000001/read?locale=en',
      'http://notification.internal:3000/api/v2/notifications/00000000-0000-4000-8000-000000000001/read?locale=en',
    ],
    [
      'POST',
      '/api/v2/notifications/read-all?userId=forged',
      'http://notification.internal:3000/api/v2/notifications/read-all?userId=forged',
    ],
  ] as const)(
    'forwards v2 %s %s to the exact v2 upstream path',
    async (method, path, upstream) => {
      const fetchRequest = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
      const response = await app.inject({
        method,
        url: path,
        headers: {
          authorization: 'Bearer verified-at-edge',
          cookie: 'must-not-forward',
          'x-user-id': 'forged',
          traceparent:
            '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(fetchRequest).toHaveBeenCalledWith(
        upstream,
        expect.objectContaining({
          method,
          redirect: 'error',
          headers: expect.objectContaining({
            authorization: 'Bearer verified-at-edge',
            'x-request-id': expect.any(String) as unknown,
            'x-correlation-id': expect.any(String) as unknown,
          }) as unknown,
        }),
      );
      const init = fetchRequest.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).has('cookie')).toBe(false);
      expect(new Headers(init.headers).has('x-user-id')).toBe(false);
      expect(new Headers(init.headers).get('traceparent')).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    },
  );
  it('rejects v2 requests without bearer auth before contacting Notification', async () => {
    const request = jest.spyOn(globalThis, 'fetch');
    expect((await app.inject('/api/v2/notifications')).statusCode).toBe(401);
    expect(request).not.toHaveBeenCalled();
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
