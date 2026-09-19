import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createServer, type Server, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app';

describe('JWT route policy through real Fastify and HTTP upstream', () => {
  const secret = randomBytes(48).toString('hex');
  const sub = randomUUID();
  const sid = randomUUID();
  const jti = randomUUID();
  const workspace = randomUUID();
  const requests: IncomingHttpHeaders[] = [];
  const saved = { ...process.env };
  let server: Server;
  let app: NestFastifyApplication;
  const token = (overrides: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub,
      sid,
      jti,
      system_role: 'USER',
      user_status: 'ACTIVE',
      iss: 'weav-identity',
      aud: 'weav-api',
      token_use: 'access',
      iat: now - 60,
      nbf: now - 60,
      exp: now + 300,
      ...overrides,
    };
    const input = [{ alg: 'HS256' }, payload]
      .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
      .join('.');
    return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
  };
  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push(req.headers);
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ upstream: true }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      APP_ENV: 'test',
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: secret,
      JWT_ISSUER: 'weav-identity',
      JWT_AUDIENCE: 'weav-api',
      JWT_CLOCK_SKEW: '30s',
      OCR_ALLOW_UNAUTHENTICATED_DEV: 'false',
      IDENTITY_SERVICE_URL: url,
      WORKSPACE_SERVICE_URL: url,
      NOTIFICATION_SERVICE_URL: url,
      OCR_SERVICE_URL: url,
    });
    app = await createApp();
    app.useGlobalInterceptors({
      intercept(context, next) {
        const principal = context
          .switchToHttp()
          .getRequest<{ principal?: { sub: string } }>().principal;
        context
          .switchToHttp()
          .getResponse()
          .header('x-test-principal', principal?.sub ?? 'anonymous');
        return next.handle();
      },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => {
    requests.length = 0;
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  it('preserves public root', async () => {
    expect((await app.inject('/')).statusCode).toBe(200);
    expect(requests).toHaveLength(0);
  });
  it.each([
    'login',
    'register',
    'refresh',
    'logout',
    'forgot-password',
    'reset-password',
  ])('keeps %s public', async (path) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/auth/${path}`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(requests).toHaveLength(1);
  });
  const required: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string]> = [
    ['GET', '/api/auth/me'],
    ['PATCH', '/api/auth/me'],
    ['POST', '/api/auth/change-password'],
    ['GET', '/api/auth/sessions'],
    ['DELETE', '/api/auth/sessions'],
    ['DELETE', `/api/auth/sessions/${sid}`],
    ['GET', '/api/users/me'],
    ['PATCH', '/api/users/me'],
    ['GET', '/api/users/me/sessions'],
    ['DELETE', '/api/users/me/sessions'],
    ['DELETE', `/api/users/me/sessions/${sid}`],
    ...['/api/notifications', '/api/v1/notifications'].flatMap(
      (prefix) =>
        [
          ['GET', prefix],
          ['GET', `${prefix}/unread-count`],
          ['PATCH', `${prefix}/${jti}/read`],
          ['POST', `${prefix}/read-all`],
        ] as Array<['GET' | 'POST' | 'PATCH', string]>,
    ),
    ['POST', `/api/v1/workspaces/${workspace}/ocr/extractions`],
  ];
  it.each(required)(
    'rejects invalid credentials before upstream: %s %s',
    async (method, url) => {
      for (const authorization of [
        undefined,
        'Bearer invalid',
        `Bearer ${token({ token_use: 'refresh' })}`,
      ]) {
        const response = await app.inject({
          method,
          url,
          headers: authorization ? { authorization } : {},
          ...(method === 'POST' || method === 'PATCH' ? { payload: {} } : {}),
        });
        expect(response.statusCode).toBe(401);
      }
      expect(requests).toHaveLength(0);
    },
  );
  it.each(['otp/request', 'otp/verify'])(
    'enforces optional policy on %s',
    async (path) => {
      const url = `/api/auth/${path}`;
      const anonymous = await app.inject({ method: 'POST', url, payload: {} });
      expect(anonymous.statusCode).toBe(200);
      expect(anonymous.headers['x-test-principal']).toBe('anonymous');
      const authorization = `Bearer ${token()}`;
      const valid = await app.inject({
        method: 'POST',
        url,
        payload: {},
        headers: {
          authorization,
          'x-user-id': 'forged',
          'x-user-role': 'ADMIN',
          'x-internal-service-key': 'forged',
        },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.headers['x-test-principal']).toBe(sub);
      expect(requests[1].authorization).toBe(authorization);
      expect(requests[1]['x-user-id']).toBeUndefined();
      expect(requests[1]['x-user-role']).toBeUndefined();
      expect(requests[1]['x-internal-service-key']).toBeUndefined();
      requests.length = 0;
      for (const authorization of [
        '',
        'Basic abc',
        'Bearer invalid',
        `Bearer ${token({ exp: 1 })}`,
        `Bearer ${token({ token_use: 'refresh' })}`,
        `Bearer ${token({ user_status: 'DISABLED' })}`,
      ]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url,
              payload: {},
              headers: { authorization },
            })
          ).statusCode,
        ).toBe(401);
      }
      expect(requests).toHaveLength(0);
    },
  );
  it('forwards the original verified Bearer on required routes', async () => {
    const authorization = `bEaReR ${token()}`;
    const response = await app.inject({
      url: '/api/users/me',
      headers: { authorization, 'x-user-id': 'forged' },
    });
    expect(response.statusCode).toBe(200);
    expect(requests[0].authorization).toBe(authorization);
    expect(requests[0]['x-user-id']).toBeUndefined();
  });
  it('limits development bypass to OCR with absent credentials', async () => {
    await app.close();
    Object.assign(process.env, {
      APP_ENV: 'development',
      OCR_ALLOW_UNAUTHENTICATED_DEV: 'true',
    });
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const url = `/api/v1/workspaces/${workspace}/ocr/extractions`;
    expect(
      (await app.inject({ method: 'POST', url, payload: {} })).statusCode,
    ).toBe(200);
    requests.length = 0;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: {},
          headers: { authorization: '' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: {},
          headers: { authorization: 'Bearer invalid' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject('/api/users/me')).statusCode).toBe(401);
    expect(requests).toHaveLength(0);
    await app.close();
    Object.assign(process.env, {
      APP_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://example.test',
    });
    await expect(createApp()).rejects.toThrow('OCR_ALLOW_UNAUTHENTICATED_DEV');
  });
});
