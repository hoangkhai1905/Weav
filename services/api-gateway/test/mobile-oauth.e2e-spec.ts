import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { createApp } from '../src/create-app';

const RATE_LIMIT_WINDOW_MS = 3_000;
jest.setTimeout(25_000);

const ORIGINAL_ENVIRONMENT = { ...process.env };
const EXCHANGE_PATH = '/api/auth/oauth/mobile/exchange';
const validBody = {
  transactionId: 'A'.repeat(43),
  handoffCode: 'B-_'.repeat(14) + 'C'.repeat(1),
  codeVerifier: `${'v'.repeat(40)}-._~`,
};
const identityResponse = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'user-id', email: 'person@gmail.com' },
};

interface UpstreamCall {
  method?: string;
  url?: string;
  body: string;
  authorization?: string;
  cookie?: string;
  forwardedFor?: string;
  userAgent?: string;
}

describe('Gateway mobile Google sign-in exchange (Fastify e2e)', () => {
  let identity: Server;
  let app: NestFastifyApplication;
  const calls: UpstreamCall[] = [];
  let upstreamStatus = 200;
  let upstreamBody: unknown = identityResponse;

  beforeAll(async () => {
    identity = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        calls.push({
          method: request.method,
          url: request.url,
          body: Buffer.concat(chunks).toString('utf8'),
          authorization: request.headers.authorization,
          cookie: request.headers.cookie,
          forwardedFor: request.headers['x-forwarded-for'] as string,
          userAgent: request.headers['user-agent'],
        });
        const payload = JSON.stringify(upstreamBody);
        response.writeHead(upstreamStatus, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
        });
        response.end(payload);
      });
    });
    await new Promise<void>((resolve, reject) => {
      identity.once('error', reject);
      identity.listen(0, '127.0.0.1', () => resolve());
    });
    const url = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      APP_ENV: 'development',
      NODE_ENV: 'test',
      PORT: '3000',
      JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
      JWT_ISSUER: 'weav-identity',
      JWT_AUDIENCE: 'weav-api',
      JWT_CLOCK_SKEW: '30s',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      OCR_ALLOW_UNAUTHENTICATED_DEV: 'true',
      IDENTITY_SERVICE_URL: url,
      WORKSPACE_SERVICE_URL: url,
      NOTIFICATION_SERVICE_URL: url,
      OCR_SERVICE_URL: url,
      GATEWAY_GENERAL_RATE_LIMIT: '50',
      GATEWAY_AUTH_RATE_LIMIT: '2',
      GATEWAY_OCR_RATE_LIMIT: '2',
      GATEWAY_RATE_LIMIT_WINDOW_MS: String(RATE_LIMIT_WINDOW_MS),
    });
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    calls.length = 0;
    upstreamStatus = 200;
    upstreamBody = identityResponse;
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => identity.close(() => resolve()));
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENVIRONMENT)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENVIRONMENT);
  });

  // Every request spends the public auth bucket (2 per window), so cases use their own address.
  let addressCounter = 100;
  const freshAddress = () => `198.51.100.${(addressCounter += 1)}`;

  const inject = (request: InjectOptions, remoteAddress: string) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ ...request, remoteAddress });

  it('relays a valid exchange publicly and returns the session body unchanged', async () => {
    const response = await inject(
      { method: 'POST', url: EXCHANGE_PATH, payload: validBody },
      freshAddress(),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(identityResponse);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('/auth/oauth/mobile/exchange');
    expect(JSON.parse(calls[0].body)).toEqual(validBody);
    expect(calls[0].authorization).toBeUndefined();
    expect(calls[0].cookie).toBeUndefined();
  });

  it('forwards the client address and user agent to Identity for its own rate limits and session metadata', async () => {
    const remoteAddress = freshAddress();
    const response = await inject(
      {
        method: 'POST',
        url: EXCHANGE_PATH,
        headers: { 'user-agent': 'WeavMobile/1.0 (Android 15)' },
        payload: validBody,
      },
      remoteAddress,
    );

    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].forwardedFor).toBe(remoteAddress);
    expect(calls[0].userAgent).toBe('WeavMobile/1.0 (Android 15)');
  });

  it.each([
    [
      401,
      {
        error: {
          code: 'OAUTH_HANDOFF_INVALID',
          message: 'The OAuth handoff is invalid',
          details: [],
        },
        status: 401,
      },
    ],
    [
      503,
      {
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message:
            'A required authentication dependency is temporarily unavailable',
          details: [],
        },
        status: 503,
      },
    ],
  ])(
    'relays an upstream %s status and error body unchanged',
    async (status, body) => {
      upstreamStatus = status;
      upstreamBody = body;

      const response = await inject(
        { method: 'POST', url: EXCHANGE_PATH, payload: validBody },
        freshAddress(),
      );

      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual(body);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(calls).toHaveLength(1);
    },
  );

  it.each([
    ['unknown field', { ...validBody, clientId: 'web' }],
    ['missing verifier', { ...validBody, codeVerifier: undefined }],
    ['short transaction id', { ...validBody, transactionId: 'short' }],
    [
      'bad handoff alphabet',
      { ...validBody, handoffCode: `${'+'.repeat(43)}` },
    ],
    ['short verifier', { ...validBody, codeVerifier: 'v'.repeat(42) }],
    [
      'verifier with a forbidden character',
      { ...validBody, codeVerifier: `${'v'.repeat(42)}=` },
    ],
    ['long verifier', { ...validBody, codeVerifier: 'v'.repeat(129) }],
  ])('rejects %s before reaching Identity', async (_name, payload) => {
    const response = await inject(
      { method: 'POST', url: EXCHANGE_PATH, payload },
      freshAddress(),
    );

    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects a non-object body before reaching Identity', async () => {
    for (const payload of ['[]', '"text"']) {
      const response = await inject(
        {
          method: 'POST',
          url: EXCHANGE_PATH,
          headers: { 'content-type': 'application/json' },
          payload,
        },
        freshAddress(),
      );
      expect(response.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('counts the exchange in the public auth bucket and answers 429 once it is spent', async () => {
    const remoteAddress = freshAddress();
    for (let index = 0; index < 2; index += 1) {
      expect(
        (
          await inject(
            { method: 'POST', url: EXCHANGE_PATH, payload: validBody },
            remoteAddress,
          )
        ).statusCode,
      ).toBe(200);
    }

    const limited = await inject(
      { method: 'POST', url: EXCHANGE_PATH, payload: validBody },
      remoteAddress,
    );
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    expect(calls).toHaveLength(2);

    // The same bucket covers the other public auth mutations from that address.
    const sharedBucket = await inject(
      { method: 'POST', url: '/api/auth/login', payload: {} },
      remoteAddress,
    );
    expect(sharedBucket.statusCode).toBe(429);
  });
});
