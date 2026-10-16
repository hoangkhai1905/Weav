import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app';

jest.setTimeout(25_000);

const ORIGINAL_ENVIRONMENT = { ...process.env };
const fixtureSecret = randomBytes(48).toString('hex');
const WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const CONNECTION_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa7';
const BASE = `/api/v1/workspaces/${WORKSPACE_ID}/connections/${CONNECTION_ID}`;

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

describe('Gateway connection test/authorize rate limit and access log (e2e)', () => {
  let upstream: Server;
  let app: NestFastifyApplication;
  let baseUrl: string;
  let upstreamCalls: number;

  beforeAll(async () => {
    upstream = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        upstreamCalls += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
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
      GATEWAY_CONNECTION_ACTION_RATE_LIMIT: '2',
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
    upstreamCalls = 0;
  });

  afterEach(() => jest.restoreAllMocks());

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

  const post = (path: string, authorization: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization },
    });

  it('limits connection test and OAuth authorize per user with the gateway 429 envelope', async () => {
    const token = bearer(randomUUID());

    expect((await post(`${BASE}/test`, token)).status).toBe(200);
    expect((await post(`${BASE}/oauth/authorize`, token)).status).toBe(200);
    const blocked = await post(`${BASE}/test`, token);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    const body = (await blocked.json()) as {
      error: { code: string; message: string; details: unknown[] };
      requestId: string;
    };
    expect(body.error).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded',
      details: [],
    });
    expect(body.requestId).toBeTruthy();
    // The blocked call never reached the upstream.
    expect(upstreamCalls).toBe(2);
    expect((await post(`${BASE}/oauth/authorize`, token)).status).toBe(429);
  });

  it('leaves other connection routes and other users unaffected', async () => {
    const token = bearer(randomUUID());
    await post(`${BASE}/test`, token);
    await post(`${BASE}/test`, token);
    expect((await post(`${BASE}/test`, token)).status).toBe(429);

    expect((await post(`${BASE}/disable`, token)).status).toBe(200);
    expect(
      (await fetch(`${baseUrl}${BASE}`, { headers: { authorization: token } }))
        .status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/workspaces/${WORKSPACE_ID}/connections`,
          { headers: { authorization: token } },
        )
      ).status,
    ).toBe(200);

    const other = bearer(randomUUID());
    expect((await post(`${BASE}/test`, other)).status).toBe(200);
    expect((await post(`${BASE}/oauth/authorize`, other)).status).toBe(200);
  });

  it('writes one access-log line with the route template and upstream, never the raw url or token', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const token = bearer(randomUUID());
    const response = await post(`${BASE}/disable?secret=hunter2`, token);
    expect(response.status).toBe(200);
    await fetch(`${baseUrl}/health`);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = log.mock.calls.map((call) => String(call[0]));
    const access = lines.filter((line) => line.startsWith('POST '));
    expect(access).toHaveLength(1);
    expect(access[0]).toMatch(
      /^POST \/api\/v1\/workspaces\/:workspaceId\/connections\/:connectionId\/disable status=200 durationMs=\d+ requestId=\S+ upstream=workspace$/,
    );
    expect(access[0]).not.toContain(WORKSPACE_ID);
    expect(access[0]).not.toContain('hunter2');
    expect(access[0]).not.toContain(token.slice(7, 30));
    expect(lines.some((line) => line.includes('/health'))).toBe(false);
  });
});
