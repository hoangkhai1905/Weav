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
      ...extra,
    };
  }
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
