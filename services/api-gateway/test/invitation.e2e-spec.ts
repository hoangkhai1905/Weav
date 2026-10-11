import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app';

jest.setTimeout(25_000);

const ORIGINAL_ENVIRONMENT = { ...process.env };
const fixtureSecret = randomBytes(48).toString('hex');
const WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const INVITATION_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa7';

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

describe('Gateway invitation routes and rate limit (e2e)', () => {
  let upstream: Server;
  let app: NestFastifyApplication;
  let baseUrl: string;
  let reply: { status: number; body: string };
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
        if (reply.status === 204) {
          response.writeHead(204);
          response.end();
          return;
        }
        response.writeHead(reply.status, {
          'content-type': 'application/json',
        });
        response.end(reply.body);
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
      GATEWAY_INVITATION_RATE_LIMIT: '3',
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
    reply = { status: 200, body: '{"items":[]}' };
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

  it('forwards the four owner routes with exact method, path, auth and body', async () => {
    const token = bearer(randomUUID());
    const base = `/api/v1/workspaces/${WORKSPACE_ID}/invitations`;
    reply = { status: 201, body: '{"id":"x"}' };

    const created = await call('POST', base, token, { email: 'a@example.com' });
    expect(created.status).toBe(201);
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: `/workspaces/${WORKSPACE_ID}/invitations`,
    });
    expect(seen[0].headers.authorization).toBe(token);
    expect(JSON.parse(seen[0].body)).toEqual({ email: 'a@example.com' });

    reply = { status: 200, body: '{"items":[]}' };
    expect((await call('GET', base, token)).status).toBe(200);
    expect(seen[1]).toMatchObject({
      method: 'GET',
      path: `/workspaces/${WORKSPACE_ID}/invitations`,
    });

    reply = { status: 204, body: '' };
    expect(
      (await call('DELETE', `${base}/${INVITATION_ID}`, token)).status,
    ).toBe(204);
    expect(seen[2]).toMatchObject({
      method: 'DELETE',
      path: `/workspaces/${WORKSPACE_ID}/invitations/${INVITATION_ID}`,
    });

    reply = { status: 200, body: '{"id":"x"}' };
    expect(
      (await call('POST', `${base}/${INVITATION_ID}/resend`, token)).status,
    ).toBe(200);
    expect(seen[3]).toMatchObject({
      method: 'POST',
      path: `/workspaces/${WORKSPACE_ID}/invitations/${INVITATION_ID}/resend`,
    });
  });

  it('forwards the three invitee routes to the literal workspace paths', async () => {
    const token = bearer(randomUUID());
    reply = { status: 200, body: '{"items":[],"emailVerified":true}' };
    expect((await call('GET', '/api/v1/invitations', token)).status).toBe(200);
    expect(seen[0]).toMatchObject({
      method: 'GET',
      path: '/workspaces/invitations',
    });

    reply = { status: 200, body: `{"workspaceId":"${WORKSPACE_ID}"}` };
    expect(
      (await call('POST', `/api/v1/invitations/${INVITATION_ID}/accept`, token))
        .status,
    ).toBe(200);
    expect(seen[1]).toMatchObject({
      method: 'POST',
      path: `/workspaces/invitations/${INVITATION_ID}/accept`,
    });

    reply = { status: 204, body: '' };
    expect(
      (
        await call(
          'POST',
          `/api/v1/invitations/${INVITATION_ID}/decline`,
          token,
        )
      ).status,
    ).toBe(204);
    expect(seen[2]).toMatchObject({
      method: 'POST',
      path: `/workspaces/invitations/${INVITATION_ID}/decline`,
    });
  });

  it('requires a valid access token and validates ids and body before any upstream call', async () => {
    const base = `/api/v1/workspaces/${WORKSPACE_ID}/invitations`;
    expect((await call('GET', '/api/v1/invitations')).status).toBe(401);
    expect(
      (await call('POST', base, undefined, { email: 'a@example.com' })).status,
    ).toBe(401);

    const token = bearer(randomUUID());
    expect(
      (await call('POST', '/api/v1/invitations/not-a-uuid/accept', token))
        .status,
    ).toBe(400);
    expect((await call('DELETE', `${base}/not-a-uuid`, token)).status).toBe(
      400,
    );
    expect(
      (await call('POST', base, token, { email: 'a@example.com', x: 1 }))
        .status,
    ).toBe(400);
    expect((await call('POST', base, token, { email: '' })).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it.each([
    [
      409,
      'POST',
      `/api/v1/invitations/${INVITATION_ID}/accept`,
      'EMAIL_NOT_VERIFIED',
    ],
    [
      410,
      'POST',
      `/api/v1/invitations/${INVITATION_ID}/accept`,
      'INVITATION_GONE',
    ],
    [
      404,
      'POST',
      `/api/v1/invitations/${INVITATION_ID}/decline`,
      'INVITATION_NOT_FOUND',
    ],
    [
      429,
      'POST',
      `/api/v1/workspaces/${WORKSPACE_ID}/invitations/${INVITATION_ID}/resend`,
      'INVITATION_RESEND_TOO_SOON',
    ],
  ])('relays upstream %s with its code', async (status, method, path, code) => {
    reply = {
      status,
      body: JSON.stringify({ code, message: 'm', requestId: 'r' }),
    };
    const response = await call(method, path, bearer(randomUUID()));
    expect(response.status).toBe(status);
    expect(((await response.json()) as { code: string }).code).toBe(code);
  });

  it('limits invitation create and resend per user, not other invitation routes', async () => {
    const token = bearer(randomUUID());
    const base = `/api/v1/workspaces/${WORKSPACE_ID}/invitations`;
    const create = () => call('POST', base, token, { email: 'a@example.com' });
    reply = { status: 201, body: '{"id":"x"}' };

    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(201);
    expect(
      (await call('POST', `${base}/${INVITATION_ID}/resend`, token)).status,
    ).toBe(201);
    const blocked = await create();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    reply = { status: 200, body: '{"items":[]}' };
    expect((await call('GET', base, token)).status).toBe(200);
    expect((await call('GET', '/api/v1/invitations', token)).status).toBe(200);
    const other = bearer(randomUUID());
    reply = { status: 201, body: '{"id":"x"}' };
    expect(
      (await call('POST', base, other, { email: 'b@example.com' })).status,
    ).toBe(201);
  });
});
