import { Expo } from 'expo-server-sdk';
import { ExpoProvider, TelegramProvider } from './providers';
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
