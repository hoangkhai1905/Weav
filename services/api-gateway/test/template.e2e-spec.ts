import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app';

jest.setTimeout(25_000);

const ORIGINAL_ENVIRONMENT = { ...process.env };
const fixtureSecret = randomBytes(48).toString('hex');
const TEMPLATE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa7';
const WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function bearer(subject: string): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: subject,
    sid: randomUUID(),
    jti: randomUUID(),
    system_role: 'USER',
    user_status: 'ACTIVE',
    token_use: 'access',
    iss: 'weav-identity',
    aud: 'weav-api',
    iat: now,
    nbf: now,
    exp: now + 3600,
  };
  const input = [{ alg: 'HS256' }, claims]
    .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
    .join('.');
  const signature = createHmac('sha256', fixtureSecret)
    .update(input)
    .digest('base64url');
  return `Bearer ${input}.${signature}`;
}

describe('Gateway template routes and rate limit (e2e)', () => {
  let upstream: Server;
  let app: NestFastifyApplication;
  let baseUrl: string;
  let seen: {
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: string;
  }[];

  beforeAll(async () => {
    upstream = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      request.on('end', () => {
        seen.push({
          method: request.method ?? '',
          path: request.url ?? '',
          headers: request.headers,
          body: raw,
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"items":[]}');
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    const url = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      APP_ENV: 'test',
      JWT_ACCESS_SECRET: fixtureSecret,
      JWT_ISSUER: 'weav-identity',
      JWT_AUDIENCE: 'weav-api',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      IDENTITY_SERVICE_URL: url,
      WORKSPACE_SERVICE_URL: url,
      WORKFLOW_SERVICE_URL: url,
      NOTIFICATION_SERVICE_URL: url,
      OCR_SERVICE_URL: url,
      AI_SERVICE_URL: url,
      GATEWAY_TEMPLATE_RATE_LIMIT: '3',
      // Many requests share one client IP; keep the general budget out of the way.
      GATEWAY_GENERAL_RATE_LIMIT: '10000',
    });
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    seen = [];
  });

  afterAll(async () => {
    app?.getHttpServer().closeAllConnections();
    await app?.close();
    await new Promise<void>((resolve) => {
      upstream.close(() => resolve());
      upstream.closeAllConnections();
    });
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENVIRONMENT)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENVIRONMENT);
  });

  const call = (
    method: string,
    path: string,
    authorization?: string,
    payload?: unknown,
  ) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(payload === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(authorization ? { authorization } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

  it('requires a valid access token and forwards method, path, auth and body', async () => {
    expect((await call('GET', '/api/v1/templates')).status).toBe(401);
    expect(seen).toHaveLength(0);

    const token = bearer(randomUUID());
    const response = await call(
      'POST',
      `/api/v1/templates/${TEMPLATE_ID}/use`,
      token,
      { workspaceId: WORKSPACE_ID },
    );

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].path).toBe(`/templates/${TEMPLATE_ID}/use`);
    expect(seen[0].headers.authorization).toBe(token);
    expect(JSON.parse(seen[0].body)).toEqual({ workspaceId: WORKSPACE_ID });
  });

  it('limits template changes and share-code lookups per user, not plain reads', async () => {
    const token = bearer(randomUUID());
    const mutation = () =>
      call('PATCH', `/api/v1/templates/${TEMPLATE_ID}`, token, {
        visibility: 'PUBLIC',
      });

    expect((await mutation()).status).toBe(200);
    expect((await mutation()).status).toBe(200);
    expect(
      (await call('GET', '/api/v1/templates/by-code/WV7K3M9Q', token)).status,
    ).toBe(200);
    const blocked = await mutation();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect(
      (await call('GET', '/api/v1/templates/by-code/WV7K3M9Q', token)).status,
    ).toBe(429);

    // Plain reads stay in the general bucket, and another user has their own budget.
    expect(
      (await call('GET', '/api/v1/templates?scope=public', token)).status,
    ).toBe(200);
    expect(
      (await call('GET', `/api/v1/templates/${TEMPLATE_ID}`, token)).status,
    ).toBe(200);
    const other = bearer(randomUUID());
    expect(
      (
        await call('PATCH', `/api/v1/templates/${TEMPLATE_ID}`, other, {
          visibility: 'PRIVATE',
        })
      ).status,
    ).toBe(200);
  });
});
