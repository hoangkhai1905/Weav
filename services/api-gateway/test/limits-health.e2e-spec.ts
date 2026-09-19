import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { createApp } from '../src/create-app';

const ORIGINAL_ENVIRONMENT = { ...process.env };
const JWT_SECRET = randomBytes(48).toString('hex');
const WORKSPACE_ID = randomUUID();

interface ReadinessFixtureState {
  mode: 'up' | 'down' | 'stall';
  calls: number;
  aborted: number;
  starts: number[];
  responseDelayMs: number;
}

const pendingTimers = new Set<NodeJS.Timeout>();

function writeJson(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function createReadinessFixture(state: ReadinessFixtureState): Server {
  return createServer((request, response) => {
    if (
      request.url?.startsWith('/auth/') ||
      request.url === '/v1/extractions'
    ) {
      request.resume();
      writeJson(response, 200, { accepted: true });
      return;
    }

    if (request.url !== '/actuator/health/readiness') {
      request.resume();
      writeJson(response, 404, { error: 'not found' });
      return;
    }

    state.calls += 1;
    state.starts.push(Date.now());
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
      }
    };
    request.on('aborted', () => {
      state.aborted += 1;
      settle();
    });
    response.on('close', () => {
      if (!response.writableFinished || state.mode === 'stall') {
        state.aborted += 1;
      }
      settle();
    });
    request.resume();

    if (state.mode === 'stall') {
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
      });
      response.write('{"status":"UP"');
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        if (!response.destroyed) {
          response.end('}');
        }
      }, 5_000);
      pendingTimers.add(timer);
      return;
    }

    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      if (state.mode === 'up') {
        writeJson(response, 200, {
          status: 'UP',
          details: { database: { status: 'UP', secret: 'do-not-expose' } },
        });
      } else {
        writeJson(response, 503, {
          status: 'DOWN',
          details: { database: { status: 'DOWN', secret: 'do-not-expose' } },
        });
      }
    }, state.responseDelayMs);
    pendingTimers.add(timer);
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function applyTestEnvironment(identityUrl: string, workspaceUrl: string): void {
  Object.assign(process.env, {
    APP_ENV: 'development',
    NODE_ENV: 'test',
    PORT: '3000',
    JWT_ACCESS_SECRET: JWT_SECRET,
    JWT_ISSUER: 'weav-identity',
    JWT_AUDIENCE: 'weav-api',
    JWT_CLOCK_SKEW: '30s',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    OCR_ALLOW_UNAUTHENTICATED_DEV: 'true',
    IDENTITY_SERVICE_URL: identityUrl,
    WORKSPACE_SERVICE_URL: workspaceUrl,
    NOTIFICATION_SERVICE_URL: identityUrl,
    OCR_SERVICE_URL: workspaceUrl,
    GATEWAY_GENERAL_RATE_LIMIT: '10',
    GATEWAY_AUTH_RATE_LIMIT: '2',
    GATEWAY_OCR_RATE_LIMIT: '2',
    GATEWAY_RATE_LIMIT_WINDOW_MS: '1000',
  });
}

function restoreEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENVIRONMENT)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENVIRONMENT);
}

async function waitForState(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for fixture state');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function authorizationFor(
  sub: string,
  secret = JWT_SECRET,
  overrides: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    sid: randomUUID(),
    jti: randomUUID(),
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
    .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
    .join('.');
  return `Bearer ${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

function errorCode(response: { json(): unknown }): unknown {
  const payload = response.json();
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  return (error as { code?: unknown }).code;
}

function responseObject(response: {
  json(): unknown;
}): Record<string, unknown> {
  const payload = response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected an object response');
  }
  return Object.fromEntries(Object.entries(payload));
}

describe('Gateway rate limits and health endpoints (Fastify e2e)', () => {
  let identityFixture: Server;
  let workspaceFixture: Server;
  let identityUrl: string;
  let workspaceUrl: string;
  let app: NestFastifyApplication;
  let identityState: ReadinessFixtureState;
  let workspaceState: ReadinessFixtureState;

  beforeAll(async () => {
    identityState = {
      mode: 'up',
      calls: 0,
      aborted: 0,
      starts: [],
      responseDelayMs: 0,
    };
    workspaceState = {
      mode: 'up',
      calls: 0,
      aborted: 0,
      starts: [],
      responseDelayMs: 0,
    };
    identityFixture = createReadinessFixture(identityState);
    workspaceFixture = createReadinessFixture(workspaceState);
    identityUrl = await listen(identityFixture);
    workspaceUrl = await listen(workspaceFixture);
    applyTestEnvironment(identityUrl, workspaceUrl);
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    for (const timer of pendingTimers) {
      clearTimeout(timer);
    }
    pendingTimers.clear();
    await app?.close();
    await new Promise<void>((resolve) =>
      identityFixture.close(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      workspaceFixture.close(() => resolve()),
    );
    restoreEnvironment();
  });

  beforeEach(() => {
    identityState.mode = 'up';
    workspaceState.mode = 'up';
    identityState.responseDelayMs = 0;
    workspaceState.responseDelayMs = 0;
    identityState.calls = 0;
    workspaceState.calls = 0;
    identityState.aborted = 0;
    workspaceState.aborted = 0;
    identityState.starts.length = 0;
    workspaceState.starts.length = 0;
  });

  const inject = (request: InjectOptions, remoteAddress: string) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        ...request,
        remoteAddress,
      });

  it('applies one general IP bucket across route variations and ignores forwarded IP spoofing', async () => {
    const remoteAddress = '198.51.100.10';
    for (let index = 0; index < 10; index += 1) {
      const response = await inject(
        {
          method: 'GET',
          url: '/',
          headers: {
            'x-forwarded-for': `203.0.113.${index}`,
          },
        },
        remoteAddress,
      );
      expect(response.statusCode).toBe(200);
    }

    const changedRoute = await inject(
      {
        method: 'POST',
        url: '/api/auth/login',
        payload: {},
        headers: { 'x-forwarded-for': '203.0.113.250' },
      },
      remoteAddress,
    );

    expect(changedRoute.statusCode).toBe(429);
    expect(changedRoute.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    expect(errorCode(changedRoute)).toBe('TOO_MANY_REQUESTS');
    expect(changedRoute.headers['x-request-id']).toBeTruthy();
  });

  it('isolates general callers by socket address, not by forwarded headers', async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await inject(
        {
          method: 'GET',
          url: '/',
          headers: { 'x-forwarded-for': '203.0.113.1' },
        },
        '198.51.100.11',
      );
      expect(response.statusCode).toBe(200);
    }

    const independentCaller = await inject(
      {
        method: 'GET',
        url: '/',
        headers: { 'x-forwarded-for': '203.0.113.1' },
      },
      '198.51.100.12',
    );
    expect(independentCaller.statusCode).toBe(200);
  });

  it('limits public auth mutations independently and recovers after the configured window', async () => {
    const remoteAddress = '198.51.100.13';
    for (let index = 0; index < 2; index += 1) {
      expect(
        (
          await inject(
            { method: 'POST', url: '/api/auth/login', payload: {} },
            remoteAddress,
          )
        ).statusCode,
      ).toBe(200);
    }

    const limited = await inject(
      { method: 'POST', url: '/api/auth/register', payload: {} },
      remoteAddress,
    );
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const recovered = await inject(
      { method: 'POST', url: '/api/auth/forgot-password', payload: {} },
      remoteAddress,
    );
    expect(recovered.statusCode).toBe(200);
  });

  it('uses a verified OCR subject, never an unverified claim, and permits IP fallback only for the dev bypass', async () => {
    const subject = randomUUID();
    const otherSubject = randomUUID();
    const remoteAddress = '198.51.100.14';
    const ocrRequest = (authorization?: string) =>
      inject(
        {
          method: 'POST',
          url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
          headers: authorization ? { authorization } : {},
          payload: {
            source: { type: 'url', fileUrl: 'https://files.example.test' },
          },
        },
        remoteAddress,
      );

    expect((await ocrRequest()).statusCode).toBe(200);
    expect((await ocrRequest()).statusCode).toBe(200);
    expect((await ocrRequest()).statusCode).toBe(429);

    expect((await ocrRequest(authorizationFor(subject))).statusCode).toBe(200);

    const independentSubject = await inject(
      {
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: { authorization: authorizationFor(otherSubject) },
        payload: {
          source: { type: 'url', fileUrl: 'https://files.example.test' },
        },
      },
      remoteAddress,
    );
    expect(independentSubject.statusCode).toBe(200);

    const forgedSubject = randomUUID();
    const invalid = await ocrRequest(
      authorizationFor(forgedSubject, randomBytes(48).toString('hex')),
    );
    expect(invalid.statusCode).toBe(401);

    const verifiedAfterInvalid = await inject(
      {
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: { authorization: authorizationFor(forgedSubject) },
        payload: {
          source: { type: 'url', fileUrl: 'https://files.example.test' },
        },
      },
      '198.51.100.15',
    );
    expect(verifiedAfterInvalid.statusCode).toBe(200);
  });

  it('exempts CORS preflight and liveness from throttling, with liveness making no upstream calls', async () => {
    const remoteAddress = '198.51.100.16';
    const healthResponses = await Promise.all(
      Array.from({ length: 12 }, () =>
        inject({ method: 'GET', url: '/health' }, remoteAddress),
      ),
    );
    expect(
      healthResponses.every((response) => response.statusCode === 200),
    ).toBe(true);
    expect(identityState.calls).toBe(0);
    expect(workspaceState.calls).toBe(0);

    const preflightResponses = await Promise.all(
      Array.from({ length: 12 }, () =>
        inject(
          {
            method: 'OPTIONS',
            url: '/api/auth/login',
            headers: {
              origin: 'http://localhost:5173',
              'access-control-request-method': 'POST',
            },
          },
          remoteAddress,
        ),
      ),
    );
    expect(
      preflightResponses.every((response) => response.statusCode === 204),
    ).toBe(true);
  });

  it('returns sanitized ready status for parallel upstream probes and recovers from a down service', async () => {
    const startedAt = Date.now();
    const ready = await inject(
      { method: 'GET', url: '/ready', headers: { 'x-request-id': 'ready-up' } },
      '198.51.100.17',
    );
    expect(ready.statusCode).toBe(200);
    expect(ready.headers['x-request-id']).toBe('ready-up');
    expect(ready.json()).toEqual({
      status: 'ok',
      requestId: 'ready-up',
      details: {
        identity: { status: 'up' },
        workspace: { status: 'up' },
      },
    });
    expect(identityState.calls).toBe(1);
    expect(workspaceState.calls).toBe(1);
    expect(
      Math.max(...identityState.starts, ...workspaceState.starts) - startedAt,
    ).toBeLessThan(1_000);

    identityState.mode = 'down';
    const down = await inject(
      { method: 'GET', url: '/ready' },
      '198.51.100.18',
    );
    expect(down.statusCode).toBe(503);
    const downPayload = responseObject(down);
    expect(downPayload.status).toBe('error');
    expect(typeof downPayload.requestId).toBe('string');
    expect(downPayload.details).toEqual({
      identity: { status: 'down' },
      workspace: { status: 'up' },
    });
    expect(down.payload).not.toContain('do-not-expose');
    expect(down.payload).not.toContain(identityUrl);
    expect(down.payload).not.toContain(workspaceUrl);

    identityState.mode = 'up';
    const recovered = await inject(
      { method: 'GET', url: '/ready' },
      '198.51.100.19',
    );
    expect(recovered.statusCode).toBe(200);
  });

  it('bounds readiness on a stalled body, then supports concurrent recovery probes', async () => {
    identityState.mode = 'stall';
    workspaceState.mode = 'up';
    const startedAt = Date.now();
    const stalled = await inject(
      { method: 'GET', url: '/ready' },
      '198.51.100.20',
    );
    const elapsed = Date.now() - startedAt;
    expect(stalled.statusCode).toBe(503);
    expect(elapsed).toBeGreaterThanOrEqual(1_800);
    expect(elapsed).toBeLessThan(3_500);
    expect(stalled.payload).not.toContain('do-not-expose');
    await waitForState(() => identityState.aborted >= 1);
    expect(identityState.aborted).toBeGreaterThanOrEqual(1);

    identityState.mode = 'up';
    const recovered = await Promise.all([
      inject({ method: 'GET', url: '/ready' }, '198.51.100.21'),
      inject({ method: 'GET', url: '/ready' }, '198.51.100.22'),
    ]);
    expect(recovered.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    expect(identityState.calls).toBe(3);
    expect(workspaceState.calls).toBe(3);
  });
});
