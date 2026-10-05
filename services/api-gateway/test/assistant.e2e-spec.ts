import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app';

jest.setTimeout(25_000);

const ORIGINAL_ENVIRONMENT = { ...process.env };
const fixtureSecret = randomBytes(48).toString('hex');
const WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function bearer(): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: randomUUID(),
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

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    workspaceId: WORKSPACE_ID,
    messages: [{ role: 'user', content: 'hello' }],
    ...extra,
  });

describe('Gateway assistant SSE route (e2e)', () => {
  let upstream: Server;
  let app: NestFastifyApplication;
  let baseUrl: string;
  let upstreamMode: 'stream' | 'error';
  let upstreamStatus = 200;
  let seen: { path: string; headers: IncomingHttpHeaders; body: string }[];
  let releaseSecondEvent: () => void;
  let upstreamFinished: boolean;
  let upstreamClosedEarly: boolean;

  beforeAll(async () => {
    upstream = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      request.on('end', () => {
        seen.push({
          path: request.url ?? '',
          headers: request.headers,
          body: raw,
        });
        if (upstreamMode === 'error') {
          response.writeHead(upstreamStatus, {
            'content-type': 'application/json',
          });
          response.end(JSON.stringify({ error: { code: 'SECRET_INTERNAL' } }));
          return;
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('event: delta\ndata: {"text":"one"}\n\n');
        const gate = new Promise<void>((resolve) => {
          releaseSecondEvent = resolve;
        });
        response.on('close', () => {
          if (!upstreamFinished) upstreamClosedEarly = true;
        });
        void gate.then(() => {
          upstreamFinished = true;
          response.end(
            'event: delta\ndata: {"text":"two"}\n\nevent: done\ndata: {}\n\n',
          );
        });
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
      GATEWAY_ASSISTANT_RATE_LIMIT: '4',
    });
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    seen = [];
    upstreamMode = 'stream';
    upstreamStatus = 200;
    upstreamFinished = false;
    upstreamClosedEarly = false;
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

  const post = (
    payload: string,
    authorization?: string,
    signal?: AbortSignal,
  ) =>
    fetch(`${baseUrl}/api/v1/assistant/chat`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: payload,
    });

  it('requires a valid access token', async () => {
    expect((await post(body())).status).toBe(401);
    expect((await post(body(), 'Bearer not.a.jwt')).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('delivers the first event before the upstream finishes, unbuffered and uncompressed', async () => {
    const token = bearer();
    const response = await fetch(`${baseUrl}/api/v1/assistant/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip, br',
        authorization: token,
      },
      body: body(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe(
      'no-cache, no-transform',
    );
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('x-request-id')).toBeTruthy();

    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"text":"one"');
    expect(upstreamFinished).toBe(false);

    releaseSecondEvent();
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toContain('"text":"two"');
    expect(rest).toContain('event: done');

    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe('/v1/assistant/chat');
    expect(seen[0].headers.authorization).toBe(token);
    expect(JSON.parse(seen[0].body)).toMatchObject({
      workspaceId: WORKSPACE_ID,
    });
  });

  it('aborts the upstream stream when the client disconnects', async () => {
    const abort = new AbortController();
    const response = await post(body(), bearer(), abort.signal);
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();
    await reader.cancel().catch(() => undefined);
    for (let i = 0; i < 50 && !upstreamClosedEarly; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(upstreamClosedEarly).toBe(true);
    releaseSecondEvent();
  });

  it.each([
    ['unknown field', { extra: 1 }],
    ['bad workspace id', { workspaceId: 'nope' }],
    ['system role', { messages: [{ role: 'system', content: 'x' }] }],
    [
      'too many messages',
      {
        messages: Array.from({ length: 21 }, () => ({
          role: 'user',
          content: 'x',
        })),
      },
    ],
    [
      'overlong message',
      { messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
    ],
  ])('rejects %s before calling the upstream', async (_name, extra) => {
    expect((await post(body(extra), bearer())).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('rejects an oversized body before buffering it or calling the upstream', async () => {
    const huge = JSON.stringify({
      workspaceId: WORKSPACE_ID,
      messages: [{ role: 'user', content: 'x'.repeat(400_000) }],
    });
    const response = await post(huge, bearer());
    expect(response.status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('maps upstream failures without relaying upstream text', async () => {
    upstreamMode = 'error';
    for (const [status, expected] of [
      [401, 401],
      [429, 429],
      [500, 502],
    ]) {
      upstreamStatus = status;
      const response = await post(body(), bearer());
      expect(response.status).toBe(expected);
      expect(await response.text()).not.toContain('SECRET_INTERNAL');
    }
  });

  it('has its own per-user rate limit', async () => {
    const token = bearer();
    upstreamMode = 'error';
    upstreamStatus = 500;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await post(body(), token)).status);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(
      0,
    );
    // Another user is unaffected.
    expect((await post(body(), bearer())).status).toBe(502);
  });
});
