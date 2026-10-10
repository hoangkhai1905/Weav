import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { InjectOptions } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app';

jest.setTimeout(25_000);

const ORIGINAL_ENVIRONMENT = { ...process.env };
const fixtureSecret = randomBytes(48).toString('hex');
const WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const CONNECTION_ID = '9fa85f64-5717-4562-b3fc-2c963f66afa6';
const USER_ID = '5fa85f64-5717-4562-b3fc-2c963f66afa6';
const ENDPOINT_KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

function bearer(role: 'USER' | 'ADMIN'): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: randomUUID(),
    sid: randomUUID(),
    jti: randomUUID(),
    system_role: role,
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

interface FixtureRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const fixtureRequests: FixtureRequest[] = [];

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
  } catch {
    // The gateway aborted a capped upload mid-stream.
  }
  return Buffer.concat(chunks);
}

function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  void (async () => {
    const body = await readBody(request);
    const path = request.url ?? '/';
    fixtureRequests.push({
      method: request.method ?? 'GET',
      path,
      headers: request.headers,
      body,
    });
    if (request.method === 'DELETE' && path === '/users/me/avatar') {
      response.writeHead(204).end();
      return;
    }
    const status = path.startsWith('/webhooks/') ? 202 : 200;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, path, bytes: body.length }));
  })();
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function multipart(size: number): { boundary: string; payload: Buffer } {
  const boundary = 'weavboundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    Buffer.alloc(size, 1),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { boundary, payload };
}

describe('Gateway routes added for full service coverage (Fastify e2e)', () => {
  let fixture: Server;
  let app: NestFastifyApplication;
  const user = bearer('USER');
  const admin = bearer('ADMIN');

  const inject = (options: InjectOptions) =>
    app.getHttpAdapter().getInstance().inject(options);

  beforeAll(async () => {
    fixture = createServer(handleFixtureRequest);
    const upstreamUrl = await listen(fixture);
    Object.assign(process.env, {
      APP_ENV: 'test',
      JWT_ACCESS_SECRET: fixtureSecret,
      JWT_ISSUER: 'weav-identity',
      JWT_AUDIENCE: 'weav-api',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      IDENTITY_SERVICE_URL: upstreamUrl,
      WORKSPACE_SERVICE_URL: upstreamUrl,
      WORKFLOW_SERVICE_URL: upstreamUrl,
      NOTIFICATION_SERVICE_URL: upstreamUrl,
      OCR_SERVICE_URL: upstreamUrl,
      GATEWAY_WEBHOOK_RATE_LIMIT: '3',
    });
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  beforeEach(() => {
    fixtureRequests.length = 0;
  });

  afterAll(async () => {
    // The aborted chunked upload leaves its unread socket open on the gateway.
    app?.getHttpServer().closeAllConnections();
    await app?.close();
    await new Promise<void>((resolve) => {
      fixture.close(() => resolve());
      fixture.closeAllConnections();
    });
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENVIRONMENT)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENVIRONMENT);
  });

  it('adds baseline security headers to every response', async () => {
    const response = await inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('allows Idempotency-Key through CORS preflight', async () => {
    const response = await inject({
      method: 'OPTIONS',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows`,
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'idempotency-key',
      },
    });
    expect(String(response.headers['access-control-allow-headers'])).toMatch(
      /Idempotency-Key/i,
    );
  });

  it('forwards a well-formed Idempotency-Key on mutations only', async () => {
    await inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows/${randomUUID()}/executions`,
      headers: { authorization: user, 'idempotency-key': 'run-12345678' },
      payload: { input: {} },
    });
    await inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows`,
      headers: {
        authorization: user,
        'idempotency-key': 'bad key with spaces',
      },
      payload: { name: 'wf' },
    });
    await inject({
      method: 'GET',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows`,
      headers: { authorization: user, 'idempotency-key': 'read-12345678' },
    });

    expect(fixtureRequests.map((r) => r.headers['idempotency-key'])).toEqual([
      'run-12345678',
      undefined,
      undefined,
    ]);
  });

  it('routes identity oauth-accounts and avatar reads and deletes', async () => {
    const list = await inject({
      method: 'GET',
      url: '/api/users/me/oauth-accounts',
      headers: { authorization: user },
    });
    const avatar = await inject({
      method: 'GET',
      url: '/api/users/me/avatar',
      headers: { authorization: user },
    });
    const removed = await inject({
      method: 'DELETE',
      url: '/api/users/me/avatar',
      headers: { authorization: user },
    });

    expect([list.statusCode, avatar.statusCode, removed.statusCode]).toEqual([
      200, 200, 204,
    ]);
    expect(fixtureRequests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /users/me/oauth-accounts',
      'GET /users/me/avatar',
      'DELETE /users/me/avatar',
    ]);

    // Unlink needs Identity's browser CSRF cookie, so it stays off the gateway.
    const unlink = await inject({
      method: 'DELETE',
      url: `/api/users/me/oauth-accounts/${randomUUID()}`,
      headers: { authorization: user },
    });
    expect(unlink.statusCode).toBe(404);
  });

  it('streams avatar multipart uploads and enforces the byte cap', async () => {
    const small = multipart(1024);
    const accepted = await inject({
      method: 'PUT',
      url: '/api/users/me/avatar',
      headers: {
        authorization: user,
        'content-type': `multipart/form-data; boundary=${small.boundary}`,
      },
      payload: small.payload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(fixtureRequests).toHaveLength(1);
    expect(fixtureRequests[0].body.equals(small.payload)).toBe(true);
    expect(fixtureRequests[0].headers['content-type']).toBe(
      `multipart/form-data; boundary=${small.boundary}`,
    );

    const large = multipart(3 * 1024 * 1024);
    const rejected = await inject({
      method: 'PUT',
      url: '/api/users/me/avatar',
      headers: {
        authorization: user,
        'content-type': `multipart/form-data; boundary=${large.boundary}`,
      },
      payload: large.payload,
    });
    expect(rejected.statusCode).toBe(413);

    const notMultipart = await inject({
      method: 'PUT',
      url: '/api/users/me/avatar',
      headers: { authorization: user },
      payload: { file: 'x' },
    });
    expect(notMultipart.statusCode).toBe(415);
    expect(fixtureRequests).toHaveLength(1);
  });

  it('caps chunked avatar uploads that declare no Content-Length', async () => {
    const address = app.getHttpServer().address() as AddressInfo;
    const { boundary, payload } = multipart(3 * 1024 * 1024);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          method: 'PUT',
          path: '/api/users/me/avatar',
          headers: {
            authorization: user,
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'transfer-encoding': 'chunked',
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
          request.destroy();
        },
      );
      request.on('error', reject);
      for (let offset = 0; offset < payload.length; offset += 64 * 1024) {
        request.write(payload.subarray(offset, offset + 64 * 1024));
      }
      request.end();
    });

    expect(status).toBe(413);
    // The aborted upstream request is recorded asynchronously; wait for it so it
    // cannot leak into the next test.
    for (let i = 0; i < 100 && fixtureRequests.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Whatever reached Identity before the abort stays under the cap.
    for (const forwarded of fixtureRequests) {
      expect(forwarded.body.length).toBeLessThanOrEqual(
        2 * 1024 * 1024 + 64 * 1024,
      );
    }
  });

  it('limits admin routes to ADMIN tokens and validates user ids', async () => {
    const forbidden = await inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: user },
    });
    expect(forbidden.statusCode).toBe(403);

    const list = await inject({
      method: 'GET',
      url: '/api/admin/users?page=1&size=20&status=DISABLED&unexpected=x',
      headers: { authorization: admin },
    });
    const detail = await inject({
      method: 'GET',
      url: `/api/admin/users/${USER_ID}`,
      headers: { authorization: admin },
    });
    const status = await inject({
      method: 'PATCH',
      url: `/api/admin/users/${USER_ID}/status`,
      headers: { authorization: admin },
      payload: { status: 'DISABLED' },
    });
    const invalid = await inject({
      method: 'GET',
      url: '/api/admin/users/not-a-uuid',
      headers: { authorization: admin },
    });

    expect([list.statusCode, detail.statusCode, status.statusCode]).toEqual([
      200, 200, 200,
    ]);
    expect(invalid.statusCode).toBe(400);
    expect(fixtureRequests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /admin/users?page=1&size=20&status=DISABLED',
      `GET /admin/users/${USER_ID}`,
      `PATCH /admin/users/${USER_ID}/status`,
    ]);
    expect(JSON.parse(fixtureRequests[2].body.toString())).toEqual({
      status: 'DISABLED',
    });
  });

  it('routes workspace credential replace and delete', async () => {
    const saved = await inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/connections/${CONNECTION_ID}/credential`,
      headers: { authorization: user },
      payload: { payload: { apiKey: 'k' }, expiresAt: '2030-01-01T00:00:00Z' },
    });
    const deleted = await inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/connections/${CONNECTION_ID}/credential`,
      headers: { authorization: user },
    });

    expect([saved.statusCode, deleted.statusCode]).toEqual([200, 200]);
    expect(fixtureRequests.map((r) => r.method)).toEqual(['PUT', 'DELETE']);
    expect(JSON.parse(fixtureRequests[0].body.toString())).toEqual({
      payload: { apiKey: 'k' },
      expiresAt: '2030-01-01T00:00:00Z',
    });
  });

  it('routes node-capabilities to the static Workflow path, not :workflowId', async () => {
    const response = await inject({
      method: 'GET',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows/node-capabilities`,
      headers: { authorization: user },
    });
    expect(response.statusCode).toBe(200);
    expect(fixtureRequests).toHaveLength(1);
    expect(fixtureRequests[0].path).toBe(
      `/workspaces/${WORKSPACE_ID}/workflows/node-capabilities`,
    );
    expect(fixtureRequests[0].method).toBe('GET');
  });

  it('routes workflow generation with its own size cap', async () => {
    const generated = await inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows/generate`,
      headers: { authorization: user },
      payload: { prompt: 'email me daily', timezone: 'Asia/Ho_Chi_Minh' },
    });
    expect(generated.statusCode).toBe(200);
    expect(fixtureRequests[0].path).toBe(
      `/workspaces/${WORKSPACE_ID}/workflows/generate`,
    );
    const answered = await inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows/generate`,
      headers: { authorization: user },
      payload: { prompt: 'email me', answers: { 'email.send.body': 'Hello' } },
    });
    expect(answered.statusCode).toBe(200);
    expect(JSON.parse(fixtureRequests[1].body.toString())).toMatchObject({
      answers: { 'email.send.body': 'Hello' },
    });
    fixtureRequests.length = 1;

    const tooLarge = await inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows/generate`,
      headers: { authorization: user },
      payload: {
        prompt: 'x',
        connections: Object.fromEntries(
          Array.from({ length: 900 }, (_, i) => [`k${i}`, CONNECTION_ID]),
        ),
      },
    });
    const invalid = await inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WORKSPACE_ID}/workflows/generate`,
      headers: { authorization: user },
      payload: { prompt: '', extra: true },
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(invalid.statusCode).toBe(400);
    expect(fixtureRequests).toHaveLength(1);
  });

  it('accepts public webhooks without forwarding client Authorization', async () => {
    const response = await inject({
      method: 'POST',
      url: `/api/v1/webhooks/${ENDPOINT_KEY}`,
      headers: {
        authorization: 'Bearer client-token-must-not-leak',
        'x-webhook-secret': 'shh-secret',
        'idempotency-key': 'delivery-0001',
      },
      payload: { event: 'push' },
    });

    expect(response.statusCode).toBe(202);
    const forwarded = fixtureRequests[0];
    expect(forwarded.path).toBe(`/webhooks/${ENDPOINT_KEY}`);
    expect(forwarded.headers.authorization).toBeUndefined();
    expect(forwarded.headers['x-webhook-secret']).toBe('shh-secret');
    expect(forwarded.headers['idempotency-key']).toBe('delivery-0001');
    expect(JSON.parse(forwarded.body.toString())).toEqual({ event: 'push' });
  });

  it('rejects malformed webhook keys and non-JSON bodies before forwarding', async () => {
    const badKey = await inject({
      method: 'POST',
      url: '/api/v1/webhooks/short',
      payload: {},
    });
    const form = await inject({
      method: 'POST',
      url: `/api/v1/webhooks/${'B'.repeat(32)}`,
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      payload: '--x--',
    });
    expect(badKey.statusCode).toBe(400);
    expect(form.statusCode).toBe(415);
    expect(fixtureRequests).toHaveLength(0);
  });

  it('rate-limits webhooks per endpoint key, not across endpoints', async () => {
    const hot = 'H'.repeat(32);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await inject({
        method: 'POST',
        url: `/api/v1/webhooks/${hot}`,
        payload: { i },
      });
      statuses.push(response.statusCode);
    }
    const other = await inject({
      method: 'POST',
      url: `/api/v1/webhooks/${'C'.repeat(32)}`,
      payload: {},
    });

    expect(statuses).toEqual([202, 202, 202, 429]);
    expect(other.statusCode).toBe(202);
  });

  it('forwards Telegram updates with only the secret-token header and never Authorization', async () => {
    const key = 'G'.repeat(32);
    const response = await inject({
      method: 'POST',
      url: `/api/v1/webhooks/telegram/${key}`,
      headers: {
        authorization: 'Bearer client-token-must-not-leak',
        'x-telegram-bot-api-secret-token': 'tg_secret-0123456789',
      },
      payload: { update_id: 7, message: { text: 'hello' } },
    });

    expect(response.statusCode).toBe(202);
    const forwarded = fixtureRequests[0];
    expect(forwarded.path).toBe(`/webhooks/telegram/${key}`);
    expect(forwarded.headers.authorization).toBeUndefined();
    expect(forwarded.headers['x-telegram-bot-api-secret-token']).toBe(
      'tg_secret-0123456789',
    );
    expect(JSON.parse(forwarded.body.toString())).toEqual({
      update_id: 7,
      message: { text: 'hello' },
    });
  });

  it('rejects malformed Telegram keys and secret tokens before forwarding', async () => {
    const badKey = await inject({
      method: 'POST',
      url: '/api/v1/webhooks/telegram/short',
      payload: {},
    });
    const badToken = await inject({
      method: 'POST',
      url: `/api/v1/webhooks/telegram/${'K'.repeat(32)}`,
      headers: { 'x-telegram-bot-api-secret-token': 'not valid!' },
      payload: {},
    });
    expect(badKey.statusCode).toBe(400);
    expect(badToken.statusCode).toBe(400);
    expect(fixtureRequests).toHaveLength(0);
  });

  it('rate-limits Telegram webhooks per endpoint key too', async () => {
    const hot = 'Q'.repeat(32);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await inject({
        method: 'POST',
        url: `/api/v1/webhooks/telegram/${hot}`,
        payload: { update_id: i },
      });
      statuses.push(response.statusCode);
    }
    const other = await inject({
      method: 'POST',
      url: `/api/v1/webhooks/telegram/${'R'.repeat(32)}`,
      payload: {},
    });

    expect(statuses).toEqual([202, 202, 202, 429]);
    expect(other.statusCode).toBe(202);
  });

  it('rejects non-UUID notification ids at the edge', async () => {
    const notification = await inject({
      method: 'PATCH',
      url: `/api/v2/notifications/${'-'.repeat(36)}/read`,
      headers: { authorization: user },
    });
    expect(notification.statusCode).toBe(400);
    expect(fixtureRequests).toHaveLength(0);
  });
});
