import { validateGatewayEnvironment } from './gateway.config';

const validAccessSecret = 'a'.repeat(32);

function developmentEnvironment(): Record<string, unknown> {
  return {
    APP_ENV: 'development',
    PORT: '3000',
    JWT_ACCESS_SECRET: validAccessSecret,
    JWT_ISSUER: 'weav-identity',
    JWT_AUDIENCE: 'weav-api',
    JWT_CLOCK_SKEW: '30s',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
    OCR_ALLOW_UNAUTHENTICATED_DEV: 'false',
    IDENTITY_SERVICE_URL: 'http://identity-service:8080',
    WORKSPACE_SERVICE_URL: 'http://workspace-service:8080',
    NOTIFICATION_SERVICE_URL: 'http://notification-service:3000',
    OCR_SERVICE_URL: 'http://ocr-service:8000',
  };
}

describe('validateGatewayEnvironment', () => {
  it('rejects a missing or short access JWT secret', () => {
    const missingSecret = developmentEnvironment();
    delete missingSecret.JWT_ACCESS_SECRET;

    expect(() => validateGatewayEnvironment(missingSecret)).toThrow(
      'JWT_ACCESS_SECRET',
    );
    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        JWT_ACCESS_SECRET: 'a'.repeat(31),
      }),
    ).toThrow('JWT_ACCESS_SECRET');
  });

  it('accepts exactly 32 UTF-8 bytes even when the character count is smaller', () => {
    const multibyteSecret = 'é'.repeat(16);

    expect(Buffer.byteLength(multibyteSecret, 'utf8')).toBe(32);
    const config = validateGatewayEnvironment({
      ...developmentEnvironment(),
      JWT_ACCESS_SECRET: multibyteSecret,
    });

    expect(config.jwt.accessSecret).toBe(multibyteSecret);
    expect(JSON.stringify(config)).not.toContain(multibyteSecret);
  });

  it('rejects credential-bearing, non-HTTP and query-bearing upstream URLs', () => {
    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        IDENTITY_SERVICE_URL: 'https://user:password@example.com',
      }),
    ).toThrow('IDENTITY_SERVICE_URL');

    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        IDENTITY_SERVICE_URL: 'file:///tmp/identity',
      }),
    ).toThrow('IDENTITY_SERVICE_URL');

    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        IDENTITY_SERVICE_URL: 'https://identity.example.test/api?token=dummy',
      }),
    ).toThrow('IDENTITY_SERVICE_URL');
  });

  it('rejects ports and clock skew values outside the safe range', () => {
    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        PORT: '0',
      }),
    ).toThrow('PORT');

    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        PORT: '65536',
      }),
    ).toThrow('PORT');

    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        JWT_CLOCK_SKEW: '-1s',
      }),
    ).toThrow('JWT_CLOCK_SKEW');

    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        JWT_CLOCK_SKEW: 'not-a-duration',
      }),
    ).toThrow('JWT_CLOCK_SKEW');
  });

  it('rejects the development OCR bypass outside explicit development', () => {
    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        APP_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://app.example.test',
        OCR_ALLOW_UNAUTHENTICATED_DEV: 'true',
      }),
    ).toThrow('OCR_ALLOW_UNAUTHENTICATED_DEV');
  });

  it('rejects the OCR bypass in test and when NODE_ENV is production', () => {
    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        APP_ENV: 'test',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
        OCR_ALLOW_UNAUTHENTICATED_DEV: 'true',
      }),
    ).toThrow('OCR_ALLOW_UNAUTHENTICATED_DEV');

    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        APP_ENV: 'development',
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://app.example.test',
        OCR_ALLOW_UNAUTHENTICATED_DEV: 'true',
      }),
    ).toThrow('OCR_ALLOW_UNAUTHENTICATED_DEV');
  });

  it('accepts a valid development environment with safe defaults', () => {
    const config = validateGatewayEnvironment(developmentEnvironment());

    expect(config.port).toBe(3000);
    expect(config.upstreams.identity).toBe('http://identity-service:8080');
    expect(config.jwt.issuer).toBe('weav-identity');
    expect(config.jwt.audience).toBe('weav-api');
    expect(config.jwt.clockSkewSeconds).toBe(30);
    expect(config.cors.allowedOrigins).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    expect(config.limits).toEqual({
      generalPerMinute: 120,
      authPerMinute: 10,
      ocrPerMinute: 10,
      windowMs: 60_000,
    });
  });

  it('validates the bounded rate-limit window and exposes test-sized overrides', () => {
    const config = validateGatewayEnvironment({
      ...developmentEnvironment(),
      GATEWAY_RATE_LIMIT_WINDOW_MS: '2500',
    });

    expect(config.limits.windowMs).toBe(2500);
    expect(() =>
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        GATEWAY_RATE_LIMIT_WINDOW_MS: '0',
      }),
    ).toThrow('GATEWAY_RATE_LIMIT_WINDOW_MS');
  });

  it('requires explicit CORS origins and accepts a valid production environment', () => {
    const missingOrigins = developmentEnvironment();
    missingOrigins.APP_ENV = 'production';
    delete missingOrigins.CORS_ALLOWED_ORIGINS;

    expect(() => validateGatewayEnvironment(missingOrigins)).toThrow(
      'CORS_ALLOWED_ORIGINS',
    );

    const config = validateGatewayEnvironment({
      ...developmentEnvironment(),
      APP_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://app.example.test',
    });

    expect(config.appEnv).toBe('production');
    expect(config.cors.allowedOrigins).toEqual(['https://app.example.test']);
  });

  it('normalizes accepted CORS origins to their URL origins', () => {
    const config = validateGatewayEnvironment({
      ...developmentEnvironment(),
      CORS_ALLOWED_ORIGINS: 'https://app.example.test/,http://localhost:5173/',
    });

    expect(config.cors.allowedOrigins).toEqual([
      'https://app.example.test',
      'http://localhost:5173',
    ]);
  });

  it('does not leak invalid secret or URL values in validation errors', () => {
    const sensitiveSecret = 'sensitive-secret';
    let errorMessage = '';

    try {
      validateGatewayEnvironment({
        ...developmentEnvironment(),
        JWT_ACCESS_SECRET: sensitiveSecret,
        IDENTITY_SERVICE_URL: 'https://user:password@example.com',
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('IDENTITY_SERVICE_URL');
    expect(errorMessage).toContain('JWT_ACCESS_SECRET');
    expect(errorMessage).not.toContain(sensitiveSecret);
    expect(errorMessage).not.toContain('user');
    expect(errorMessage).not.toContain('password');
  });
});
