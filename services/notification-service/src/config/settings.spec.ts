import { loadSettings } from './settings';
import { testSettings } from '../testing/fixtures';

describe('notification configuration validation', () => {
  function env(extra: Record<string, string> = {}) {
    const s = testSettings();
    return {
      DB_HOST: s.DB_HOST,
      DB_NAME: s.DB_NAME,
      DB_USERNAME: s.DB_USERNAME,
      DB_PASSWORD: s.DB_PASSWORD,
      JWT_ACCESS_SECRET: s.JWT_ACCESS_SECRET,
      RABBITMQ_USERNAME: s.RABBITMQ_USERNAME,
      RABBITMQ_PASSWORD: s.RABBITMQ_PASSWORD,
      ...extra,
    };
  }
  it('requires SMTP settings only when e-mail is enabled', () => {
    expect(loadSettings(env()).NOTIFICATION_EMAIL_ENABLED).toBe(false);
    expect(() =>
      loadSettings(env({ NOTIFICATION_EMAIL_ENABLED: 'true' })),
    ).toThrow('SMTP_HOST');
    expect(() =>
      loadSettings(
        env({
          NOTIFICATION_EMAIL_ENABLED: 'true',
          NOTIFICATION_DETAIL_BASE_URL: 'https://weav.test',
          SMTP_HOST: 'smtp.test',
          SMTP_FROM_ADDRESS: 'no-reply@weav.test',
          SMTP_AUTH_ENABLED: 'true',
          SMTP_STARTTLS_ENABLED: 'true',
        }),
      ),
    ).toThrow('SMTP_USERNAME');
    expect(
      loadSettings(
        env({
          NOTIFICATION_EMAIL_ENABLED: 'true',
          NOTIFICATION_DETAIL_BASE_URL: 'https://weav.test',
          SMTP_HOST: 'smtp.test',
          SMTP_FROM_ADDRESS: 'no-reply@weav.test',
        }),
      ).SMTP_PORT,
    ).toBe(587);
  });
  describe('invitation e-mail link and TLS guards', () => {
    const email = {
      NOTIFICATION_EMAIL_ENABLED: 'true',
      NOTIFICATION_DETAIL_BASE_URL: 'https://weav.test',
      SMTP_HOST: 'smtp.test',
      SMTP_FROM_ADDRESS: 'no-reply@weav.test',
    };
    it('requires NOTIFICATION_DETAIL_BASE_URL when e-mail is enabled', () => {
      const { NOTIFICATION_DETAIL_BASE_URL: _omit, ...rest } = email;
      expect(() => loadSettings(env(rest))).toThrow(
        'NOTIFICATION_DETAIL_BASE_URL',
      );
    });
    it.each([
      'https://weav.test',
      'http://localhost:5173',
      'http://localhost',
      'http://127.0.0.1:5173',
    ])('accepts base URL %s', (url) => {
      expect(() =>
        loadSettings(env({ ...email, NOTIFICATION_DETAIL_BASE_URL: url })),
      ).not.toThrow();
    });
    it.each([
      'http://weav.test',
      'http://localhost.evil.test',
      'http://user:pw@localhost:5173',
      'http://localhost:5173/?q=1',
      'https://weav.test/#frag',
      'ftp://localhost',
    ])('rejects base URL %s', (url) => {
      expect(() =>
        loadSettings(env({ ...email, NOTIFICATION_DETAIL_BASE_URL: url })),
      ).toThrow('NOTIFICATION_DETAIL_BASE_URL');
    });
    it('keeps the HTTPS-only rule for the Telegram link when e-mail is off', () => {
      expect(() =>
        loadSettings(env({ NOTIFICATION_DETAIL_BASE_URL: 'http://weav.test' })),
      ).toThrow('NOTIFICATION_DETAIL_BASE_URL');
      expect(
        loadSettings(
          env({ NOTIFICATION_DETAIL_BASE_URL: 'http://localhost:5173' }),
        ).NOTIFICATION_DETAIL_BASE_URL,
      ).toBe('http://localhost:5173');
    });
    it('rejects STARTTLS_REQUIRED without STARTTLS or SSL', () => {
      expect(() =>
        loadSettings(env({ ...email, SMTP_STARTTLS_REQUIRED: 'true' })),
      ).toThrow('SMTP_STARTTLS_REQUIRED');
      expect(
        loadSettings(
          env({
            ...email,
            SMTP_STARTTLS_REQUIRED: 'true',
            SMTP_STARTTLS_ENABLED: 'true',
          }),
        ).SMTP_STARTTLS_REQUIRED,
      ).toBe(true);
      expect(
        loadSettings(
          env({
            ...email,
            SMTP_STARTTLS_REQUIRED: 'true',
            SMTP_SSL_ENABLED: 'true',
          }),
        ).SMTP_SSL_ENABLED,
      ).toBe(true);
    });
    it('rejects credentials in clear (auth without STARTTLS or SSL)', () => {
      const auth = {
        ...email,
        SMTP_AUTH_ENABLED: 'true',
        SMTP_USERNAME: 'u',
        SMTP_PASSWORD: 'p',
      };
      expect(() => loadSettings(env(auth))).toThrow('SMTP_AUTH_ENABLED');
      expect(
        loadSettings(env({ ...auth, SMTP_SSL_ENABLED: 'true' }))
          .SMTP_AUTH_ENABLED,
      ).toBe(true);
    });
  });
  it.each(['RABBITMQ_USERNAME', 'RABBITMQ_PASSWORD'])(
    'requires broker credential %s (no guest default)',
    (key) => {
      expect(() => loadSettings(env({ [key]: '' }))).toThrow(key);
      const rest: Record<string, string> = env();
      delete rest[key];
      expect(() => loadSettings(rest)).toThrow(key);
    },
  );
  it('prefers the NOTIFICATION_RABBITMQ_* broker user and falls back when empty', () => {
    const own = loadSettings(
      env({
        NOTIFICATION_RABBITMQ_USERNAME: 'own-user',
        NOTIFICATION_RABBITMQ_PASSWORD: 'own-pass',
      }),
    );
    expect([own.RABBITMQ_USERNAME, own.RABBITMQ_PASSWORD]).toEqual([
      'own-user',
      'own-pass',
    ]);
    const shared = loadSettings(env({ NOTIFICATION_RABBITMQ_USERNAME: '' }));
    expect(shared.RABBITMQ_USERNAME).toBe(env().RABBITMQ_USERNAME);
  });
  it.each([
    'https://user:private@example.com',
    'https://example.com?token=private',
    'https://example.com#private',
    'http://example.com',
  ])('rejects unsafe detail links %s', (value) => {
    expect(() =>
      loadSettings(env({ NOTIFICATION_DETAIL_BASE_URL: value })),
    ).toThrow('NOTIFICATION_DETAIL_BASE_URL');
  });
  it('accepts safe HTTPS base paths', () => {
    expect(
      loadSettings(
        env({ NOTIFICATION_DETAIL_BASE_URL: 'https://weav.example/app' }),
      ).NOTIFICATION_DETAIL_BASE_URL,
    ).toBe('https://weav.example/app');
  });
  it('treats an empty optional detail URL as disabled', () => {
    expect(
      loadSettings(env({ NOTIFICATION_DETAIL_BASE_URL: '' }))
        .NOTIFICATION_DETAIL_BASE_URL,
    ).toBeUndefined();
  });
  it('does not leak invalid environment values', () => {
    expect(() => loadSettings(env({ JWT_ACCESS_SECRET: 'private' }))).toThrow(
      'Invalid notification configuration: JWT_ACCESS_SECRET',
    );
  });
  it('requires provider credentials and a lease longer than request timeouts', () => {
    expect(() =>
      loadSettings(env({ NOTIFICATION_TELEGRAM_ENABLED: 'true' })),
    ).toThrow('TELEGRAM_BOT_TOKEN');
    expect(() => loadSettings(env({ NOTIFICATION_LEASE_MS: '1000' }))).toThrow(
      'NOTIFICATION_LEASE_MS',
    );
  });
});
