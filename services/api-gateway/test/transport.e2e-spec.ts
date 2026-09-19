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
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app';

jest.setTimeout(25_000);

const ORIGINAL_ENVIRONMENT = { ...process.env };
const fixtureSecret = randomBytes(48).toString('hex');
const signedAuthorization: Record<string, string> = Object.fromEntries(
  [
    'redirect-token',
    'slow-token',
    'slow-body-token',
    'non-json-error-token',
    'measure-limit-token',
    'normal-slow-token',
    'opaque-access-token',
    'progressive-upload-token',
  ].map((label) => {
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
    return [
      label,
      `Bearer ${input}.${createHmac('sha256', fixtureSecret).update(input).digest('base64url')}`,
    ];
  }),
);

const WORKSPACE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const VALID_TRACEPARENT =
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

interface FixtureRequest {
  path: string;
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

function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const record: FixtureRequest = {
      path: url.pathname,
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

    if (url.pathname === '/auth/register') {
      response.writeHead(302, {
        location: '/auth/login',
        'x-upstream-secret': 'never-forward',
      });
      response.end();
      return;
    }

    record.body = await readBody(request);

    if (url.pathname === '/auth/login') {
      writeJson(
        response,
        200,
        { accepted: true, source: 'identity' },
        {
          'cache-control': 'private',
          'retry-after': '5',
          'x-upstream-secret': 'never-forward',
        },
      );
      return;
    }

    if (url.pathname === '/auth/refresh') {
      response.writeHead(204, {
        'x-upstream-secret': 'never-forward',
      });
      response.end();
      return;
    }

    if (url.pathname === '/users/me') {
      response.writeHead(502, {
        'content-type': 'text/plain',
        'retry-after': '9',
        'x-upstream-secret': 'database-password',
      });
      response.end('raw upstream failure database-password');
      return;
    }

    if (url.pathname === '/api/v1/notifications') {
      writeJson(
        response,
        429,
        {
          error: { code: 'NOTIFICATION_RATE_LIMITED', message: 'try later' },
          upstreamField: 'preserve-me',
        },
        {
          'retry-after': '7',
          'x-upstream-secret': 'database-password',
        },
      );
      return;
    }

    if (url.pathname === '/v1/extractions') {
      if (
        request.headers.authorization === signedAuthorization['redirect-token']
      ) {
        response.writeHead(302, { location: '/unexpected' });
        response.end();
        return;
      }

      if (request.headers.authorization === signedAuthorization['slow-token']) {
        const timer = setTimeout(() => {
          pendingTimers.delete(timer);
          if (!response.writableEnded) {
            writeJson(response, 200, { accepted: true });
          }
        }, 11_000);
        pendingTimers.add(timer);
        return;
      }

      if (
        request.headers.authorization === signedAuthorization['slow-body-token']
      ) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"accepted":');
        const timer = setTimeout(() => {
          pendingTimers.delete(timer);
          if (!response.writableEnded) {
            response.end('true}');
          }
        }, 11_000);
        pendingTimers.add(timer);
        return;
      }

      if (
        request.headers.authorization ===
        signedAuthorization['non-json-error-token']
      ) {
        response.writeHead(500, { 'content-type': 'text/html' });
        response.end('<html>secretmarker</html>');
        return;
      }

      if (
        request.headers.authorization ===
        signedAuthorization['measure-limit-token']
      ) {
        writeJson(response, 200, {
          accepted: true,
          contentType: request.headers['content-type'],
          receivedLength: Buffer.byteLength(record.body),
        });
        return;
      }

      if (
        request.headers.authorization ===
        signedAuthorization['normal-slow-token']
      ) {
        const timer = setTimeout(() => {
          pendingTimers.delete(timer);
          if (!response.writableEnded) {
            writeJson(response, 200, {
              accepted: true,
              contentType: request.headers['content-type'],
              body: record.body,
            });
          }
        }, 100);
        pendingTimers.add(timer);
        return;
      }

      writeJson(response, 200, {
        accepted: true,
        contentType: request.headers['content-type'],
        body: record.body,
      });
      return;
    }

    writeJson(response, 404, { error: { code: 'NOT_FOUND' } });
  })();
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function applyTestEnvironment(upstreamUrl: string): void {
  Object.assign(process.env, {
    APP_ENV: 'test',
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

describe('Gateway transport boundary (Fastify e2e)', () => {
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
    await new Promise<void>((resolve, reject) => {
      fixture.close((error) => (error ? reject(error) : resolve()));
    });
    restoreEnvironment();
  });

  it('propagates one canonical ID and forwards only safe request headers', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'x-request-id': 'req-transport',
          'x-correlation-id': 'other-id',
          traceparent: VALID_TRACEPARENT,
          cookie: 'session=secret',
          'x-internal-service-key': 'secret',
          'x-user-id': 'forged-user',
          'x-user-role': 'admin',
          'x-forwarded-for': '198.51.100.1',
        },
        payload: { email: 'person@example.test' },
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, source: 'identity' });
    expect(response.headers['x-request-id']).toBe('req-transport');
    expect(response.headers['x-correlation-id']).toBe('req-transport');
    expect(response.headers['retry-after']).toBe('5');
    expect(response.headers['x-upstream-secret']).toBeUndefined();

    const forwarded = fixtureRequests.find(
      ({ path }) => path === '/auth/login',
    );
    expect(forwarded).toBeDefined();
    expect(forwarded?.headers['x-request-id']).toBe('req-transport');
    expect(forwarded?.headers['x-correlation-id']).toBe('req-transport');
    expect(forwarded?.headers.traceparent).toBe(VALID_TRACEPARENT);
    expect(forwarded?.headers.cookie).toBeUndefined();
    expect(forwarded?.headers['x-internal-service-key']).toBeUndefined();
    expect(forwarded?.headers['x-user-id']).toBeUndefined();
    expect(forwarded?.headers['x-user-role']).toBeUndefined();
    expect(forwarded?.headers['x-forwarded-for']).toBeUndefined();
  });

  it('preserves upstream 204 responses without forcing JSON parsing', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          'x-correlation-id': 'corr-204',
        },
        payload: { refreshToken: 'opaque-refresh-token' },
      });

    expect(response.statusCode).toBe(204);
    expect(response.payload).toBe('');
    expect(response.headers['x-request-id']).toBe('corr-204');
    expect(response.headers['x-correlation-id']).toBe('corr-204');
  });

  it('preserves upstream notification business errors and safe response headers', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/api/v1/notifications?unread=true',
        headers: {
          authorization: signedAuthorization['opaque-access-token'],
          'x-request-id': 'req-notification',
        },
      });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: { code: 'NOTIFICATION_RATE_LIMITED', message: 'try later' },
      upstreamField: 'preserve-me',
    });
    expect(response.headers['retry-after']).toBe('7');
    expect(response.headers['x-upstream-secret']).toBeUndefined();
    expect(response.headers['x-request-id']).toBe('req-notification');
    expect(response.headers['x-correlation-id']).toBe('req-notification');
  });

  it('sanitizes non-JSON upstream failures and rejects redirects without leaking details', async () => {
    const nonJson = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: signedAuthorization['opaque-access-token'],
          'x-request-id': 'req-non-json',
        },
      });

    expect(nonJson.statusCode).toBe(502);
    expect(nonJson.json()).toEqual({
      error: {
        code: 'BAD_GATEWAY',
        message: 'Invalid Identity response',
        details: [],
      },
      status: 502,
      requestId: 'req-non-json',
    });
    expect(nonJson.payload).not.toContain('database-password');
    expect(nonJson.headers['x-upstream-secret']).toBeUndefined();

    const redirect = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-request-id': 'req-redirect' },
        payload: { email: 'person@example.test' },
      });

    expect(redirect.statusCode).toBe(503);
    expect(redirect.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Identity service unavailable',
        details: [],
      },
      status: 503,
      requestId: 'req-redirect',
    });
    expect(redirect.headers.location).toBeUndefined();
    expect(redirect.payload).not.toContain('never-forward');
  });

  it('preserves OCR multipart boundaries and keeps invalid trace context and client-only headers out', async () => {
    const boundary = '----GatewayBoundary';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="sample.txt"',
      'Content-Type: text/plain',
      '',
      'gateway-stream-body',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: {
          authorization: signedAuthorization['opaque-access-token'],
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'x-request-id': 'req-ocr-stream',
          traceparent: 'not-a-traceparent',
          cookie: 'session=secret',
          'x-internal-service-key': 'secret',
        },
        payload: multipartBody,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: true,
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: multipartBody,
    });
    const forwarded = fixtureRequests.find(
      ({ path }) => path === '/v1/extractions',
    );
    expect(forwarded?.headers['x-request-id']).toBe('req-ocr-stream');
    expect(forwarded?.headers['x-correlation-id']).toBe('req-ocr-stream');
    expect(forwarded?.headers.traceparent).toBeUndefined();
    expect(forwarded?.headers.cookie).toBeUndefined();
    expect(forwarded?.headers['x-internal-service-key']).toBeUndefined();
  });

  it('keeps a progressive multipart upload alive until the body has ended', async () => {
    const boundary = '----GatewayProgressiveBoundary';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="progressive.txt"',
      'Content-Type: text/plain',
      '',
      'progressive-upload-body',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const firstChunk = multipartBody.slice(0, 32);
    const remainingBody = multipartBody.slice(32);
    const address = app
      .getHttpAdapter()
      .getInstance()
      .server.address() as AddressInfo;

    const response = await new Promise<{
      statusCode: number;
      body: string;
    }>((resolve, reject) => {
      let settled = false;
      const client = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          method: 'POST',
          path: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
          headers: {
            authorization: signedAuthorization['progressive-upload-token'],
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'content-length': Buffer.byteLength(multipartBody),
            'x-request-id': 'req-ocr-progressive',
          },
        },
        (upstreamResponse) => {
          const chunks: Buffer[] = [];
          upstreamResponse.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamResponse.once('end', () => {
            settled = true;
            if (delayTimer) clearTimeout(delayTimer);
            resolve({
              statusCode: upstreamResponse.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      client.once('error', (error) => {
        if (!settled) {
          settled = true;
          if (delayTimer) clearTimeout(delayTimer);
          reject(error);
        }
      });
      client.write(firstChunk);
      const delayTimer = setTimeout(() => {
        client.end(remainingBody);
      }, 100);
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      accepted: true,
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: multipartBody,
    });
    const forwarded = fixtureRequests.find(
      ({ path, headers }) =>
        path === '/v1/extractions' &&
        headers.authorization ===
          signedAuthorization['progressive-upload-token'],
    );
    expect(forwarded?.body).toBe(multipartBody);
    expect(forwarded?.aborted).toBe(false);
  });

  it('rejects OCR upstream redirects instead of following them', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: {
          authorization: signedAuthorization['redirect-token'],
          'content-type': 'application/json',
          'x-request-id': 'req-ocr-redirect',
        },
        payload: {
          source: { type: 'url', fileUrl: 'https://files.example.test' },
        },
      });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'OCR_BUSY',
        message: 'OCR service is temporarily unavailable',
        retryable: true,
      },
      requestId: 'req-ocr-redirect',
    });
  });

  it('sanitizes non-JSON OCR errors without leaking the upstream body', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: {
          authorization: signedAuthorization['non-json-error-token'],
          'content-type': 'application/json',
          'x-request-id': 'req-ocr-non-json-error',
        },
        payload: {
          source: { type: 'url', fileUrl: 'https://files.example.test' },
        },
      });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['x-request-id']).toBe('req-ocr-non-json-error');
    expect(response.headers['x-correlation-id']).toBe('req-ocr-non-json-error');
    expect(response.json()).toEqual({
      error: {
        code: 'OCR_BUSY',
        message: 'OCR service is temporarily unavailable',
        retryable: true,
      },
      requestId: 'req-ocr-non-json-error',
    });
    expect(response.payload).not.toContain('secretmarker');
  });

  it('measures the existing OCR multipart parser limit without applying Identity JSON limits', async () => {
    const boundary = '----GatewayLimitBoundary';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="large.txt"',
      'Content-Type: text/plain',
      '',
      'x'.repeat(1_100_000),
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: {
          authorization: signedAuthorization['measure-limit-token'],
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'x-request-id': 'req-ocr-limit',
        },
        payload: multipartBody,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: true,
      contentType: `multipart/form-data; boundary=${boundary}`,
      receivedLength: Buffer.byteLength(multipartBody),
    });
  });

  it('returns OCR_BUSY with the canonical ID after the 10-second upstream deadline', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: {
          authorization: signedAuthorization['slow-token'],
          'content-type': 'application/json',
          'x-request-id': 'req-ocr-timeout',
        },
        payload: {
          source: { type: 'url', fileUrl: 'https://files.example.test' },
        },
      });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'OCR_BUSY',
        message: 'OCR service is temporarily unavailable',
        retryable: true,
      },
      requestId: 'req-ocr-timeout',
    });
    await waitFor(() =>
      fixtureRequests.some(
        ({ path, aborted }) => path === '/v1/extractions' && aborted,
      ),
    );
  });

  it('returns OCR_BUSY when an upstream JSON body stalls after headers', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: {
          authorization: signedAuthorization['slow-body-token'],
          'content-type': 'application/json',
          'x-request-id': 'req-ocr-stalled-body',
        },
        payload: {
          source: { type: 'url', fileUrl: 'https://files.example.test' },
        },
      });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'OCR_BUSY',
        message: 'OCR service is temporarily unavailable',
        retryable: true,
      },
      requestId: 'req-ocr-stalled-body',
    });
    await waitFor(() =>
      fixtureRequests.some(
        ({ path, headers, aborted }) =>
          path === '/v1/extractions' &&
          headers.authorization === signedAuthorization['slow-body-token'] &&
          aborted,
      ),
    );
  });

  it('does not cancel a normal completed POST while the upstream response is delayed', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
        headers: {
          authorization: signedAuthorization['normal-slow-token'],
          'content-type': 'application/json',
          'x-request-id': 'req-normal-slow',
        },
        payload: {
          source: { type: 'url', fileUrl: 'https://files.example.test' },
        },
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: true,
      contentType: 'application/json',
      body: JSON.stringify({
        source: { type: 'url', fileUrl: 'https://files.example.test' },
      }),
    });
  });

  it('cancels an in-flight OCR upstream request when the real client disconnects', async () => {
    const address = app
      .getHttpAdapter()
      .getInstance()
      .server.address() as AddressInfo;
    const payload = JSON.stringify({
      source: { type: 'url', fileUrl: 'https://files.example.test' },
    });

    await new Promise<void>((resolve, reject) => {
      const client = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          method: 'POST',
          path: `/api/v1/workspaces/${WORKSPACE_ID}/ocr/extractions`,
          headers: {
            authorization: signedAuthorization['slow-token'],
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
        },
        (response) => {
          response.resume();
        },
      );
      client.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ECONNRESET') {
          reject(error);
        }
      });
      client.end(payload);
      void (async () => {
        try {
          await waitFor(() =>
            fixtureRequests.some(
              ({ path, headers, body }) =>
                path === '/v1/extractions' &&
                headers.authorization === signedAuthorization['slow-token'] &&
                body.length > 0,
            ),
          );
          client.destroy();
          await waitFor(() =>
            fixtureRequests.some(
              ({ path, aborted }) => path === '/v1/extractions' && aborted,
            ),
          );
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    expect(
      fixtureRequests.some(
        ({ path, aborted }) => path === '/v1/extractions' && aborted,
      ),
    ).toBe(true);
  });

  it('keeps Fastify parser failures at their safe 400, 413 and 415 statuses', async () => {
    const invalidJson = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-invalid-json',
        },
        payload: '{"email":',
      });

    expect(invalidJson.statusCode).toBe(400);
    expect(invalidJson.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'BAD_REQUEST',
          details: [],
        }) as unknown,
        requestId: 'req-invalid-json',
      }),
    );

    const unsupportedMedia = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/xml',
          'x-request-id': 'req-unsupported-media',
        },
        payload: '<login />',
      });

    expect(unsupportedMedia.statusCode).toBe(415);
    expect(unsupportedMedia.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          details: [],
        }) as unknown,
        requestId: 'req-unsupported-media',
      }),
    );

    const tooLarge = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-too-large',
        },
        payload: JSON.stringify({ data: 'x'.repeat(1_048_576) }),
      });

    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'PAYLOAD_TOO_LARGE',
          details: [],
        }) as unknown,
        requestId: 'req-too-large',
      }),
    );
  });
});
