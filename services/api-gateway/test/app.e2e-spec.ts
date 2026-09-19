import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { createApp } from '../src/create-app';

const originalEnvironment = { ...process.env };

function applyTestEnvironment(): void {
  Object.assign(process.env, {
    APP_ENV: 'development',
    PORT: '3000',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_ISSUER: 'weav-identity',
    JWT_AUDIENCE: 'weav-api',
    JWT_CLOCK_SKEW: '30s',
    CORS_ALLOWED_ORIGINS: ' http://localhost:5173/ ',
    OCR_ALLOW_UNAUTHENTICATED_DEV: 'false',
    IDENTITY_SERVICE_URL: ' http://identity-service:8080 ',
    WORKSPACE_SERVICE_URL: 'http://workspace-service:8080',
    NOTIFICATION_SERVICE_URL: 'http://notification-service:3000',
    OCR_SERVICE_URL: 'http://ocr-service:8000',
  });
}

function restoreEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnvironment);
}

describe('Gateway Fastify bootstrap (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    applyTestEnvironment();
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(() => {
    restoreEnvironment();
  });

  it('serves the root route through the production Fastify bootstrap', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toBe('Hello World!');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.headers['x-correlation-id']).toBe(
      response.headers['x-request-id'],
    );
  });

  it('exposes validated normalized values to existing ConfigService consumers', () => {
    const config = app.get(ConfigService);

    expect(config.get<string>('IDENTITY_SERVICE_URL')).toBe(
      'http://identity-service:8080',
    );
    expect(config.get<string>('CORS_ALLOWED_ORIGINS')).toBe(
      'http://localhost:5173',
    );
    expect(config.get<string>('OCR_ALLOW_UNAUTHENTICATED_DEV')).toBe('false');
  });

  it('allows configured origins and denies unconfigured CORS preflight origins', async () => {
    const allowed = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'OPTIONS',
        url: '/',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'GET',
        },
      });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );

    const exposed = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/',
        headers: { origin: 'http://localhost:5173' },
      });

    expect(exposed.headers['access-control-expose-headers']).toEqual(
      expect.stringContaining('X-Request-ID'),
    );
    expect(exposed.headers['access-control-expose-headers']).toEqual(
      expect.stringContaining('X-Correlation-ID'),
    );

    const denied = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'OPTIONS',
        url: '/',
        headers: {
          origin: 'https://untrusted.example.test',
          'access-control-request-method': 'GET',
        },
      });

    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
