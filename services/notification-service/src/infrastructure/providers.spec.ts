import { Logger } from '@nestjs/common';
import { Expo } from 'expo-server-sdk';
import {
  EmailProvider,
  ExpoProvider,
  renderInvitationEmail,
  TelegramProvider,
} from './providers';
import { testDelivery, testSettings } from '../testing/fixtures';

describe('provider adapters', () => {
  afterEach(() => jest.restoreAllMocks());
  it('sends Telegram with a finite timeout', async () => {
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const provider = new TelegramProvider(testSettings());
    const row = testDelivery();
    expect(await provider.send(row)).toEqual({ kind: 'sent' });
    expect(request.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      signal: expect.any(AbortSignal) as AbortSignal,
      redirect: 'error',
    });
    const requestBody = request.mock.calls[0][1]?.body;
    if (typeof requestBody !== 'string')
      throw new Error('Expected JSON request body');
    expect(JSON.parse(requestBody)).toMatchObject({
      chat_id: row.destination,
    });
  });
  it.each([400, 401, 403, 429, 500, 503])(
    'classifies Telegram HTTP %s',
    async (status) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error_code: status,
            description: 'private',
            parameters: { retry_after: 7 },
          }),
          { status },
        ),
      );
      await expect(
        new TelegramProvider(testSettings()).send(testDelivery()),
      ).rejects.toMatchObject({
        code: `TELEGRAM_${status}`,
        retryable: status === 429 || status >= 500,
        retryAfterMs: 7000,
      });
    },
  );
  it('handles Telegram timeout and invalid destinations', async () => {
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('secret-url'));
    const provider = new TelegramProvider(testSettings());
    await expect(provider.send(testDelivery())).rejects.toMatchObject({
      code: 'TELEGRAM_UNAVAILABLE',
      retryable: true,
    });
    const d = testDelivery();
    d.destination = 'invalid';
    await expect(provider.send(d)).rejects.toMatchObject({
      code: 'INVALID_DESTINATION',
      retryable: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  function fakeExpo() {
    const provider = new ExpoProvider(testSettings());
    const client = new Expo();
    jest.spyOn(provider, 'createClient').mockReturnValue(client);
    return { provider, client };
  }
  it('sanitizes unrecognized Expo error codes', async () => {
    const { provider, client } = fakeExpo();
    const row = testDelivery();
    row.destination = 'ExponentPushToken[test-device]';
    jest.spyOn(client, 'sendPushNotificationsAsync').mockResolvedValue([
      {
        status: 'error',
        message: 'private',
        details: { error: 'private-token' as 'DeviceNotRegistered' },
      },
    ]);
    await expect(provider.send(row)).rejects.toMatchObject({
      code: 'EXPO_UnknownError',
    });
  });
  it('uses SDK chunking and returns a receipt ticket', async () => {
    const { provider, client } = fakeExpo();
    const row = testDelivery();
    row.destination = 'ExponentPushToken[test-device]';
    const chunk = jest.spyOn(client, 'chunkPushNotifications');
    jest
      .spyOn(client, 'sendPushNotificationsAsync')
      .mockResolvedValue([{ status: 'ok', id: 'ticket' }]);
    expect(await provider.send(row)).toEqual({ kind: 'receipt', id: 'ticket' });
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(chunk.mock.calls[0][0][0]).toMatchObject({ collapseId: row.id });
  });
  it.each([
    'DeviceNotRegistered',
    'MessageTooBig',
    'InvalidCredentials',
    'MessageRateExceeded',
  ] as const)('classifies Expo %s', async (code) => {
    const { provider, client } = fakeExpo();
    const row = testDelivery();
    row.destination = 'ExponentPushToken[test-device]';
    jest
      .spyOn(client, 'sendPushNotificationsAsync')
      .mockResolvedValue([
        { status: 'error', message: 'private', details: { error: code } },
      ]);
    await expect(provider.send(row)).rejects.toMatchObject({
      code: `EXPO_${code}`,
      retryable: code === 'MessageRateExceeded',
    });
  });
  it('checks missing, failed, and successful receipts', async () => {
    const { provider, client } = fakeExpo();
    const request = jest
      .spyOn(client, 'getPushNotificationReceiptsAsync')
      .mockResolvedValue({});
    expect(await provider.receipt('ticket')).toEqual({ kind: 'pending' });
    request.mockResolvedValue({
      ticket: {
        status: 'error',
        message: 'private',
        details: { error: 'DeviceNotRegistered' },
      },
    });
    await expect(provider.receipt('ticket')).rejects.toMatchObject({
      code: 'EXPO_DeviceNotRegistered',
      retryable: false,
    });
    request.mockResolvedValue({ ticket: { status: 'ok' } });
    expect(await provider.receipt('ticket')).toEqual({ kind: 'sent' });
  });
  it('rejects invalid Expo tokens before network calls', async () => {
    const { provider, client } = fakeExpo();
    const send = jest.spyOn(client, 'sendPushNotificationsAsync');
    await expect(provider.send(testDelivery())).rejects.toMatchObject({
      code: 'INVALID_DESTINATION',
      retryable: false,
    });
    expect(send).not.toHaveBeenCalled();
  });
  it('bounds stalled SDK calls', async () => {
    const settings = testSettings();
    settings.NOTIFICATION_TIMEOUT_MS = 100;
    const provider = new ExpoProvider(settings);
    const client = new Expo();
    jest.spyOn(provider, 'createClient').mockReturnValue(client);
    jest
      .spyOn(client, 'getPushNotificationReceiptsAsync')
      .mockImplementation(() => new Promise(() => undefined));
    await expect(provider.receipt('ticket')).rejects.toMatchObject({
      code: 'EXPO_TIMEOUT',
      retryable: true,
    });
  });
});

describe('invitation e-mail', () => {
  const payload = {
    workspaceName: 'Đội vận hành',
    inviterName: 'Nguyễn An',
    expiresAt: '2026-10-17T04:00:00Z',
  };
  const emailDelivery = (destination = 'new.member@example.com') => ({
    ...testDelivery(),
    provider: 'EMAIL' as const,
    eventType: 'workspace.invitation.created',
    destination,
    payload,
  });
  const settings = (over: Record<string, unknown> = {}) =>
    testSettings({
      NOTIFICATION_EMAIL_ENABLED: true,
      SMTP_HOST: 'smtp.test',
      SMTP_FROM_ADDRESS: 'no-reply@weav.test',
      NOTIFICATION_DETAIL_BASE_URL: 'https://weav.test/',
      ...over,
    });
  function providerWith(sendMail: jest.Mock, over = {}) {
    const provider = new EmailProvider(settings(over));
    jest
      .spyOn(provider, 'createTransport')
      .mockReturnValue({ sendMail } as never);
    return provider;
  }

  it('renders both languages with inviter, workspace, link and expiry', () => {
    const { subject, text } = renderInvitationEmail(
      payload,
      'https://weav.test/',
    );
    expect(subject).toContain('Đội vận hành');
    expect(text).toContain('Nguyễn An');
    expect(text).toContain('https://weav.test/invitations');
    expect(text).toContain('Sign up or sign in with this address');
    expect(text).toContain('Hãy đăng ký hoặc đăng nhập');
    expect(text).toMatch(/2026/);
  });

  it('is permanently disabled unless NOTIFICATION_EMAIL_ENABLED is set', async () => {
    await expect(
      new EmailProvider(settings({ NOTIFICATION_EMAIL_ENABLED: false })).send(
        emailDelivery(),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_DISABLED', retryable: false });
  });

  it.each([
    'not-an-email',
    'a b@example.com',
    `${'a'.repeat(330)}@x.test`,
    'a,b@example.com',
    'a;b@example.com',
    '"a"@example.com',
    '<a@example.com>',
    'a@example.com,b@example.com',
  ])('rejects destination %#', async (destination) => {
    const sendMail = jest.fn();
    await expect(
      providerWith(sendMail).send(emailDelivery(destination)),
    ).rejects.toMatchObject({
      code: 'INVALID_DESTINATION',
      retryable: false,
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects any event type other than the invitation with a permanent INVALID_EVENT', async () => {
    const sendMail = jest.fn();
    await expect(
      providerWith(sendMail).send({
        ...emailDelivery(),
        eventType: 'workflow.completed',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EVENT', retryable: false });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('gives up after twice the provider timeout, closes the transport and retries later', async () => {
    jest.useFakeTimers();
    try {
      const close = jest.fn();
      const provider = new EmailProvider(
        settings({ NOTIFICATION_TIMEOUT_MS: 500 }),
      );
      const sendMail = jest.fn(() => new Promise(() => undefined));
      jest
        .spyOn(provider, 'createTransport')
        .mockReturnValue({ sendMail, close } as never);
      const result = provider.send(emailDelivery());
      const assertion = expect(result).rejects.toMatchObject({
        code: 'SMTP_UNAVAILABLE',
        retryable: true,
      });
      await jest.advanceTimersByTimeAsync(999);
      expect(close).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(2);
      await assertion;
      expect(close).toHaveBeenCalledTimes(1);
      // The stuck transport is dropped: the next send builds a new one.
      const second = jest.fn().mockResolvedValue({});
      jest
        .spyOn(provider, 'createTransport')
        .mockReturnValue({ sendMail: second, close } as never);
      expect(await provider.send(emailDelivery())).toEqual({ kind: 'sent' });
      expect(second).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends through the transport and reports sent', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    expect(await providerWith(sendMail).send(emailDelivery())).toEqual({
      kind: 'sent',
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { name: '', address: 'new.member@example.com' },
        from: { name: 'Weav', address: 'no-reply@weav.test' },
      }),
    );
  });

  it.each([
    [450, true],
    [421, true],
    [550, false],
    [535, false],
    [undefined, true],
  ])('classifies SMTP code %s (retryable=%s)', async (code, retryable) => {
    const sendMail = jest.fn().mockRejectedValue(
      Object.assign(new Error('secret new.member@example.com'), {
        responseCode: code,
      }),
    );
    await expect(
      providerWith(sendMail).send(emailDelivery()),
    ).rejects.toMatchObject({
      code: `SMTP_${code ?? 'UNAVAILABLE'}`,
      retryable,
    });
  });

  it('never logs the destination or body', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const sendMail = jest.fn().mockRejectedValue(new Error('boom'));
    await providerWith(sendMail)
      .send(emailDelivery())
      .catch(() => undefined);
    for (const spy of [...spies, consoleSpy])
      expect(JSON.stringify(spy.mock.calls)).not.toContain('new.member');
  });
});
