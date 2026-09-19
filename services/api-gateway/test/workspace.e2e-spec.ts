import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app';

jest.setTimeout(30_000);

const ORIGINAL_ENVIRONMENT = { ...process.env };
const fixtureSecret = randomBytes(48).toString('hex');
const WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const USER_ID = '5fa85f64-5717-4562-b3fc-2c963f66afa6';
const VALID_TRACEPARENT =
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const workspaceResponse = {
  id: WORKSPACE_ID,
  name: 'Demo workspace',
  createdBy: USER_ID,
  createdAt: '2026-09-19T00:00:00Z',
  updatedAt: '2026-09-19T00:00:00Z',
};

const memberResponse = {
  userId: USER_ID,
  email: 'person@example.test',
  displayName: 'Person',
  active: true,
  role: 'MEMBER',
  canPublishWorkflow: true,
  canManageWorkflowState: false,
  joinedAt: '2026-09-19T00:00:00Z',
  updatedAt: '2026-09-19T00:00:00Z',
};

const signedAuthorization: Record<string, string> = Object.fromEntries(
  [
    'normal-token',
    'redirect-token',
    'slow-token',
    'slow-body-token',
    'mutation-failure-token',
    'status-401-token',
    'status-403-token',
    'status-404-token',
    'status-409-token',
  ].map((label) => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: USER_ID,
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
    return [
      label,
      `Bearer ${input}.${createHmac('sha256', fixtureSecret).update(input).digest('base64url')}`,
    ];
  }),
);

interface FixtureRequest {
  method: string;
  path: string;
  search: string;
  headers: IncomingHttpHeaders;
  body: string;
  aborted: boolean;
}

const fixtureRequests: FixtureRequest[] = [];
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, {
    'content-type': 'application/json',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string | Uint8Array),
    );
  }
  return Buffer.concat(chunks).toString('utf8');
}

function page<T>(items: T[]) {
  return {
    items,
    page: 0,
    size: 20,
    totalElements: items.length,
    totalPages: items.length === 0 ? 0 : 1,
  };
}

function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const record: FixtureRequest = {
      method: request.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      headers: request.headers,
      body: '',
      aborted: false,
    };
    fixtureRequests.push(record);
    request.once('aborted', () => {
      record.aborted = true;
    });
    response.once('close', () => {
      if (response.writableFinished !== true) {
        record.aborted = true;
      }
    });

    const authorization = request.headers.authorization;
    if (
      url.pathname === '/workspaces' &&
      authorization === signedAuthorization['redirect-token']
    ) {
      response.writeHead(302, {
        location: '/workspaces/final',
        'x-upstream-secret': 'never-forward',
      });
      response.end();
      return;
    }

    try {
      record.body = await readBody(request);
    } catch {
      record.aborted = true;
      response.destroy();
      return;
    }

    if (
      url.pathname === '/workspaces' &&
      authorization === signedAuthorization['slow-token']
    ) {
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        writeJson(response, 201, workspaceResponse);
      }, 11_000);
      pendingTimers.add(timer);
      return;
    }

    if (
      url.pathname === `/workspaces/${WORKSPACE_ID}` &&
      authorization === signedAuthorization['slow-body-token']
    ) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"id":');
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        if (!response.writableEnded && !response.destroyed) {
          response.end(JSON.stringify(WORKSPACE_ID));
        }
      }, 11_000);
      pendingTimers.add(timer);
      return;
    }

    if (
      url.pathname === '/workspaces' &&
      request.method === 'POST' &&
      authorization === signedAuthorization['mutation-failure-token']
    ) {
      writeJson(response, 503, {
        error: { code: 'WORKSPACE_BUSY', message: 'try later' },
      });
      return;
    }

    const preservedStatus = [401, 403, 404, 409].find(
      (status) =>
        authorization === signedAuthorization[`status-${status}-token`],
    );
    if (
      url.pathname === `/workspaces/${WORKSPACE_ID}` &&
      request.method === 'GET' &&
      preservedStatus
    ) {
      writeJson(response, preservedStatus, {
        error: {
          code: `WORKSPACE_${preservedStatus}`,
          message: 'downstream response',
        },
        downstreamField: 'preserve-me',
      });
      return;
    }

    switch (`${request.method} ${url.pathname}`) {
      case 'POST /workspaces':
        writeJson(response, 201, workspaceResponse, {
          'x-upstream-secret': 'never-forward',
        });
        return;
      case 'GET /workspaces':
        writeJson(response, 200, page([workspaceResponse]), {
          'x-upstream-secret': 'never-forward',
        });
        return;
      case `GET /workspaces/${WORKSPACE_ID}`:
      case `PATCH /workspaces/${WORKSPACE_ID}`:
        writeJson(response, 200, workspaceResponse, {
          'x-upstream-secret': 'never-forward',
        });
        return;
      case `GET /workspaces/${WORKSPACE_ID}/members`:
        writeJson(response, 200, page([memberResponse]), {
          'x-upstream-secret': 'never-forward',
        });
        return;
      case `POST /workspaces/${WORKSPACE_ID}/members`:
        writeJson(response, 201, memberResponse, {
          'x-upstream-secret': 'never-forward',
        });
        return;
      case `PATCH /workspaces/${WORKSPACE_ID}/members/${USER_ID}/permissions`:
        writeJson(response, 200, memberResponse, {
          'x-upstream-secret': 'never-forward',
        });
        return;
      case `DELETE /workspaces/${WORKSPACE_ID}/members/${USER_ID}`:
      case `DELETE /workspaces/${WORKSPACE_ID}/members/me`:
        response.writeHead(204, { 'x-upstream-secret': 'never-forward' });
        response.end();
        return;
      case 'POST /v1/extractions':
        writeJson(response, 200, { accepted: true });
        return;
      default:
        writeJson(response, 404, { error: { code: 'NOT_FOUND' } });
    }
  })();
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for fixture state');
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function applyTestEnvironment(upstreamUrl: string): void {
  Object.assign(process.env, {
    APP_ENV: 'test',
    NODE_ENV: 'test',
    PORT: '3000',
    JWT_ACCESS_SECRET: fixtureSecret,
    JWT_ISSUER: 'weav-identity',
    JWT_AUDIENCE: 'weav-api',
    JWT_CLOCK_SKEW: '30s',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    OCR_ALLOW_UNAUTHENTICATED_DEV: 'false',
    IDENTITY_SERVICE_URL: upstreamUrl,
    WORKSPACE_SERVICE_URL: upstreamUrl,
    NOTIFICATION_SERVICE_URL: upstreamUrl,
    OCR_SERVICE_URL: upstreamUrl,
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

function extractOperations(document: string): string[] {
  const operations: string[] = [];
  let path: string | undefined;
  for (const line of document.split(/\r?\n/)) {
    const pathMatch = /^ {2}(\/[^:]+):$/.exec(line);
    if (pathMatch) {
      path = pathMatch[1];
      continue;
    }
    const methodMatch = /^ {4}(get|post|patch|delete):$/.exec(line);
    if (path && methodMatch) {
      operations.push(`${methodMatch[1].toUpperCase()} ${path}`);
    }
  }
  return operations;
}

describe('Workspace gateway public API (Fastify e2e)', () => {
  let fixture: Server;
  let upstreamUrl: string;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    fixture = createServer(handleFixtureRequest);
    upstreamUrl = await listen(fixture);
    applyTestEnvironment(upstreamUrl);
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  beforeEach(() => {
    fixtureRequests.length = 0;
  });

  afterAll(async () => {
    for (const timer of pendingTimers) {
      clearTimeout(timer);
    }
    pendingTimers.clear();
    await app.close();
    await new Promise<void>((resolveClose, reject) => {
      fixture.close((error) => (error ? reject(error) : resolveClose()));
    });
    restoreEnvironment();
  });

  it('proxies all nine public operations with exact paths and preserved responses', async () => {
    const operations: Array<{
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      url: string;
      upstreamPath: string;
      status: number;
      payload?: Record<string, unknown>;
      expectedBody?: unknown;
      expectedQuery?: Record<string, string>;
    }> = [
      {
        method: 'POST',
        url: '/api/v1/workspaces',
        upstreamPath: '/workspaces',
        status: 201,
        payload: { name: 'Demo workspace' },
        expectedBody: workspaceResponse,
      },
      {
        method: 'GET',
        url: '/api/v1/workspaces?search=Acme%20Team&role=OWNER&page=2&size=10&sort=updatedAt&direction=desc',
        upstreamPath: '/workspaces',
        status: 200,
        expectedBody: page([workspaceResponse]),
        expectedQuery: {
          search: 'Acme Team',
          role: 'OWNER',
          page: '2',
          size: '10',
          sort: 'updatedAt',
          direction: 'desc',
        },
      },
      {
        method: 'GET',
        url: `/api/v1/workspaces/${WORKSPACE_ID}`,
        upstreamPath: `/workspaces/${WORKSPACE_ID}`,
        status: 200,
        expectedBody: workspaceResponse,
      },
      {
        method: 'PATCH',
        url: `/api/v1/workspaces/${WORKSPACE_ID}`,
        upstreamPath: `/workspaces/${WORKSPACE_ID}`,
        status: 200,
        payload: { name: 'Renamed workspace' },
        expectedBody: workspaceResponse,
      },
      {
        method: 'GET',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members?search=Person&role=MEMBER&canPublishWorkflow=true&canManageWorkflowState=false&page=1&size=5&sort=joinedAt&direction=asc`,
        upstreamPath: `/workspaces/${WORKSPACE_ID}/members`,
        status: 200,
        expectedBody: page([memberResponse]),
        expectedQuery: {
          search: 'Person',
          role: 'MEMBER',
          canPublishWorkflow: 'true',
          canManageWorkflowState: 'false',
          page: '1',
          size: '5',
          sort: 'joinedAt',
          direction: 'asc',
        },
      },
      {
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members`,
        upstreamPath: `/workspaces/${WORKSPACE_ID}/members`,
        status: 201,
        payload: { email: 'person@example.test' },
        expectedBody: memberResponse,
      },
      {
        method: 'PATCH',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members/${USER_ID}/permissions`,
        upstreamPath: `/workspaces/${WORKSPACE_ID}/members/${USER_ID}/permissions`,
        status: 200,
        payload: {
          canPublishWorkflow: true,
          canManageWorkflowState: false,
        },
        expectedBody: memberResponse,
      },
      {
        method: 'DELETE',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members/${USER_ID}`,
        upstreamPath: `/workspaces/${WORKSPACE_ID}/members/${USER_ID}`,
        status: 204,
      },
      {
        method: 'DELETE',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members/me`,
        upstreamPath: `/workspaces/${WORKSPACE_ID}/members/me`,
        status: 204,
      },
    ];

    for (const [index, operation] of operations.entries()) {
      const requestId = `workspace-operation-${index}`;
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: operation.method,
          url: operation.url,
          headers: {
            authorization: `bEaReR ${signedAuthorization['normal-token'].slice(7)}`,
            'x-request-id': requestId,
            'x-correlation-id': 'discarded-correlation-id',
            traceparent: VALID_TRACEPARENT,
            cookie: 'session=secret',
            'x-internal-service-key': 'forged-secret',
            'x-user-id': 'forged-user',
            'x-user-role': 'ADMIN',
          },
          ...(operation.payload === undefined
            ? {}
            : { payload: operation.payload }),
        });

      expect(response.statusCode).toBe(operation.status);
      expect(response.headers['x-request-id']).toBe(requestId);
      expect(response.headers['x-correlation-id']).toBe(requestId);
      expect(response.headers['x-upstream-secret']).toBeUndefined();
      if (operation.status === 204) {
        expect(response.payload).toBe('');
      } else {
        expect(response.json()).toEqual(operation.expectedBody);
      }

      const forwarded = fixtureRequests.at(-1);
      expect(forwarded?.method).toBe(operation.method);
      expect(forwarded?.path).toBe(operation.upstreamPath);
      expect(forwarded?.headers.authorization).toBe(
        `bEaReR ${signedAuthorization['normal-token'].slice(7)}`,
      );
      expect(forwarded?.headers['x-request-id']).toBe(requestId);
      expect(forwarded?.headers['x-correlation-id']).toBe(requestId);
      expect(forwarded?.headers.traceparent).toBe(VALID_TRACEPARENT);
      expect(forwarded?.headers.cookie).toBeUndefined();
      expect(forwarded?.headers['x-internal-service-key']).toBeUndefined();
      expect(forwarded?.headers['x-user-id']).toBeUndefined();
      expect(forwarded?.headers['x-user-role']).toBeUndefined();
      if (operation.payload !== undefined) {
        expect(JSON.parse(forwarded?.body ?? '')).toEqual(operation.payload);
      }
      if (operation.expectedQuery) {
        expect(
          Object.fromEntries(new URLSearchParams(forwarded?.search)),
        ).toEqual(operation.expectedQuery);
      } else {
        expect(forwarded?.search).toBe('');
      }
    }
  });

  it('rejects invalid UUID/query/body inputs before any upstream request', async () => {
    const authorization = signedAuthorization['normal-token'];
    const invalidRequests: Array<{
      method: 'GET' | 'POST' | 'PATCH';
      url: string;
      payload?: Record<string, unknown>;
    }> = [
      { method: 'GET', url: '/api/v1/workspaces/not-a-uuid' },
      { method: 'GET', url: '/api/v1/workspaces?page=-1' },
      { method: 'GET', url: '/api/v1/workspaces?size=101' },
      { method: 'GET', url: '/api/v1/workspaces?sort=role' },
      { method: 'GET', url: '/api/v1/workspaces?unexpected=value' },
      {
        method: 'GET',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members?canPublishWorkflow=maybe`,
      },
      {
        method: 'POST',
        url: '/api/v1/workspaces',
        payload: { name: '' },
      },
      {
        method: 'POST',
        url: '/api/v1/workspaces',
        payload: { name: 'valid', unexpected: true },
      },
      {
        method: 'PATCH',
        url: `/api/v1/workspaces/${WORKSPACE_ID}`,
        payload: { name: '' },
      },
      {
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members`,
        payload: { email: 'person@example.test', unexpected: true },
      },
      {
        method: 'PATCH',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members/${USER_ID}/permissions`,
        payload: { canPublishWorkflow: true },
      },
    ];

    for (const invalidRequest of invalidRequests) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: invalidRequest.method,
          url: invalidRequest.url,
          headers: { authorization },
          ...(invalidRequest.payload === undefined
            ? {}
            : { payload: invalidRequest.payload }),
        });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'BAD_REQUEST',
          }) as unknown,
        }),
      );
    }

    expect(fixtureRequests).toHaveLength(0);
  });

  it('requires a valid access JWT before reaching Workspace', async () => {
    const missing = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ url: `/api/v1/workspaces/${WORKSPACE_ID}` });
    const invalid = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        url: `/api/v1/workspaces/${WORKSPACE_ID}`,
        headers: { authorization: 'Bearer invalid' },
      });

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(fixtureRequests).toHaveLength(0);
  });

  it('does not expose internal, traversal, encoded-separator, or unsupported-method routes', async () => {
    const authorization = {
      authorization: signedAuthorization['normal-token'],
    };
    const attempts = [
      {
        method: 'GET' as const,
        url: `/api/v1/workspaces/internal/workspaces/${WORKSPACE_ID}/users/${USER_ID}/access`,
      },
      {
        method: 'GET' as const,
        url: `/api/v1/workspaces/${WORKSPACE_ID}/%2e%2e/internal`,
      },
      {
        method: 'GET' as const,
        url: `/api/v1/workspaces/${WORKSPACE_ID}/members/${encodeURIComponent(`${USER_ID}/internal`)}`,
      },
      {
        method: 'PUT' as const,
        url: `/api/v1/workspaces/${WORKSPACE_ID}`,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/workspaces/${WORKSPACE_ID}`,
      },
    ];

    for (const attempt of attempts) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ ...attempt, headers: authorization });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(fixtureRequests).toHaveLength(0);
  });

  it('keeps OCR route precedence separate from Workspace forwarding', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: {
          authorization: signedAuthorization['normal-token'],
          'content-type': 'application/json',
        },
        payload: {
          source: { type: 'url', fileUrl: 'https://files.example.test' },
        },
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true });
    expect(fixtureRequests.map(({ path }) => path)).toEqual([
      '/v1/extractions',
    ]);
  });

  it('rejects redirects and does not retry a failed mutation', async () => {
    const redirect = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        url: '/api/v1/workspaces',
        headers: { authorization: signedAuthorization['redirect-token'] },
      });

    expect(redirect.statusCode).toBe(503);
    expect(redirect.headers.location).toBeUndefined();
    expect(redirect.payload).not.toContain('never-forward');
    expect(fixtureRequests).toHaveLength(1);
    expect(fixtureRequests[0].path).toBe('/workspaces');

    fixtureRequests.length = 0;
    const failedMutation = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          authorization: signedAuthorization['mutation-failure-token'],
        },
        payload: { name: 'do not retry' },
      });

    expect(failedMutation.statusCode).toBe(503);
    expect(failedMutation.json()).toEqual({
      error: { code: 'WORKSPACE_BUSY', message: 'try later' },
    });
    expect(fixtureRequests).toHaveLength(1);
  });

  it('preserves downstream 401, 403, 404, and 409 JSON responses', async () => {
    for (const status of [401, 403, 404, 409]) {
      fixtureRequests.length = 0;
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          url: `/api/v1/workspaces/${WORKSPACE_ID}`,
          headers: {
            authorization: signedAuthorization[`status-${status}-token`],
          },
        });

      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({
        error: {
          code: `WORKSPACE_${status}`,
          message: 'downstream response',
        },
        downstreamField: 'preserve-me',
      });
      expect(fixtureRequests).toHaveLength(1);
      expect(fixtureRequests[0].path).toBe(`/workspaces/${WORKSPACE_ID}`);
    }
  });

  it('applies the ten-second deadline while reading an upstream response body', async () => {
    const startedAt = Date.now();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        url: `/api/v1/workspaces/${WORKSPACE_ID}`,
        headers: { authorization: signedAuthorization['slow-body-token'] },
      });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(9_500);
    expect(response.statusCode).toBe(503);
    expect(response.payload).not.toContain('"id"');
    await waitFor(() => fixtureRequests.some(({ aborted }) => aborted));
    expect(fixtureRequests[0].aborted).toBe(true);
  });

  it('cancels the upstream request when the client disconnects', async () => {
    const address = app
      .getHttpAdapter()
      .getInstance()
      .server.address() as AddressInfo;

    await new Promise<void>((resolveDisconnect, reject) => {
      let settled = false;
      const client = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          method: 'POST',
          path: '/api/v1/workspaces',
          headers: {
            authorization: signedAuthorization['slow-token'],
            'content-type': 'application/json',
            'content-length': Buffer.byteLength('{"name":"disconnect"}'),
          },
        },
        (response) => response.resume(),
      );
      client.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ECONNRESET' && !settled) {
          settled = true;
          reject(error);
        }
      });
      client.end('{"name":"disconnect"}');

      void (async () => {
        try {
          await waitFor(() =>
            fixtureRequests.some(
              ({ path, headers }) =>
                path === '/workspaces' &&
                headers.authorization === signedAuthorization['slow-token'],
            ),
          );
          client.destroy();
          await waitFor(() =>
            fixtureRequests.some(
              ({ path, headers, aborted }) =>
                path === '/workspaces' &&
                headers.authorization === signedAuthorization['slow-token'] &&
                aborted,
            ),
          );
          if (!settled) {
            settled = true;
            resolveDisconnect();
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
      })();
    });

    expect(
      fixtureRequests.some(
        ({ path, headers, aborted }) =>
          path === '/workspaces' &&
          headers.authorization === signedAuthorization['slow-token'] &&
          aborted,
      ),
    ).toBe(true);
  });

  it('keeps the gateway contract to exactly nine Workspace method/path pairs and resolvable refs', () => {
    const gatewayPath = resolve(
      __dirname,
      '../../../packages/contracts/http/gateway/openapi.yaml',
    );
    const gatewayDocument = readFileSync(gatewayPath, 'utf8');
    const expected = [
      'POST /api/v1/workspaces',
      'GET /api/v1/workspaces',
      'GET /api/v1/workspaces/{workspaceId}',
      'PATCH /api/v1/workspaces/{workspaceId}',
      'GET /api/v1/workspaces/{workspaceId}/members',
      'POST /api/v1/workspaces/{workspaceId}/members',
      'PATCH /api/v1/workspaces/{workspaceId}/members/{userId}/permissions',
      'DELETE /api/v1/workspaces/{workspaceId}/members/{userId}',
      'DELETE /api/v1/workspaces/{workspaceId}/members/me',
    ];
    const actual = extractOperations(gatewayDocument);

    expect(actual).toHaveLength(expected.length);
    expect(actual).toEqual(expect.arrayContaining(expected));
    expect(gatewayDocument).not.toContain('/internal/');

    const references = [
      ...gatewayDocument.matchAll(/\$ref:\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1]);
    for (const reference of references) {
      const [relativeFile, fragment] = reference.split('#');
      const referencedPath = relativeFile
        ? resolve(dirname(gatewayPath), relativeFile)
        : gatewayPath;
      const referencedDocument = readFileSync(referencedPath, 'utf8');
      expect(referencedDocument).toBeTruthy();
      if (fragment) {
        const anchor = fragment.split('/').at(-1);
        expect(anchor).toBeTruthy();
        const escapedAnchor = anchor?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(referencedDocument).toMatch(
          new RegExp(`^\\s{2,}${escapedAnchor}:`, 'm'),
        );
      }
    }
  });
});
