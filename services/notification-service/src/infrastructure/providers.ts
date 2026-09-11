import { Inject, Injectable } from '@nestjs/common';
import { Expo } from 'expo-server-sdk';
import type { ExpoPushErrorReceipt } from 'expo-server-sdk';
import { Agent } from 'undici';
import { SETTINGS } from '../config/settings';
import type { Settings } from '../config/settings';
import { DeliveryError } from '../domain/notification';
import type {
  Delivery,
  NotificationProvider,
  SendResult,
} from '../domain/notification';

export function renderMessage(d: Delivery, baseUrl?: string): string {
  const link =
    baseUrl && d.executionId
      ? `${baseUrl.replace(/\/$/, '')}/executions/${d.executionId}`
      : '';
  return [
    d.payload.title,
    d.payload.workflowName,
    d.payload.message,
    d.executionId,
    link,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 3500);
}
@Injectable()
export class TelegramProvider implements NotificationProvider {
  constructor(@Inject(SETTINGS) private readonly settings: Settings) {}
  async send(d: Delivery): Promise<SendResult> {
    if (!/^-?\d{1,20}$|^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(d.destination))
      throw new DeliveryError('INVALID_DESTINATION', false);
    if (!this.settings.NOTIFICATION_TELEGRAM_ENABLED)
      throw new DeliveryError('PROVIDER_DISABLED', false);
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.settings.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(this.settings.NOTIFICATION_TIMEOUT_MS),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: d.destination,
            text: renderMessage(d, this.settings.NOTIFICATION_DETAIL_BASE_URL),
            link_preview_options: { is_disabled: true },
          }),
        },
      );
      const body = (await response.json()) as {
        ok?: boolean;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (!response.ok || body.ok !== true) {
        const code = body.error_code ?? response.status;
        const seconds = body.parameters?.retry_after;
        const header = response.headers.get('retry-after');
        const retryMs = Number.isFinite(seconds)
          ? Number(seconds) * 1000
          : header
            ? /^\d+$/.test(header)
              ? Number(header) * 1000
              : Math.max(0, Date.parse(header) - Date.now())
            : 0;
        throw new DeliveryError(
          `TELEGRAM_${code}`,
          code === 429 || code >= 500,
          Number.isFinite(retryMs) ? retryMs : 0,
        );
      }
      return { kind: 'sent' };
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      throw new DeliveryError('TELEGRAM_UNAVAILABLE', true);
    }
  }
}
const permanentExpo = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'InvalidCredentials',
  'DeveloperError',
]);
function expoFailure(result: ExpoPushErrorReceipt): never {
  const raw = result.details?.error;
  const code =
    raw && (permanentExpo.has(raw) || raw === 'MessageRateExceeded')
      ? raw
      : 'UnknownError';
  throw new DeliveryError(`EXPO_${code}`, !permanentExpo.has(code), 0, true);
}
@Injectable()
export class ExpoProvider implements NotificationProvider {
  constructor(@Inject(SETTINGS) private readonly settings: Settings) {}
  createClient(agent: Agent): Expo {
    return new Expo({
      httpAgent: agent,
      accessToken: this.settings.EXPO_ACCESS_TOKEN,
      maxConcurrentRequests: 1,
      retryMinTimeout: 100,
    });
  }
  private async request<T>(call: (client: Expo) => Promise<T>): Promise<T> {
    if (!this.settings.NOTIFICATION_EXPO_ENABLED)
      throw new DeliveryError('PROVIDER_DISABLED', false);
    const agent = new Agent({
      connectTimeout: this.settings.NOTIFICATION_TIMEOUT_MS,
      headersTimeout: this.settings.NOTIFICATION_TIMEOUT_MS,
      bodyTimeout: this.settings.NOTIFICATION_TIMEOUT_MS,
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        call(this.createClient(agent)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void agent.destroy();
            reject(new DeliveryError('EXPO_TIMEOUT', true));
          }, this.settings.NOTIFICATION_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      if (e instanceof DeliveryError) throw e;
      const status = (e as { statusCode?: number })?.statusCode;
      throw new DeliveryError(
        'EXPO_UNAVAILABLE',
        !status || status === 429 || status >= 500,
      );
    } finally {
      clearTimeout(timer);
      await agent.destroy();
    }
  }
  async send(d: Delivery): Promise<SendResult> {
    if (!Expo.isExpoPushToken(d.destination))
      throw new DeliveryError('INVALID_DESTINATION', false);
    return this.request(async (client) => {
      const chunks = client.chunkPushNotifications([
        {
          to: d.destination,
          title: String(d.payload.title),
          body: String(d.payload.message),
          data: { notificationId: d.id, executionId: d.executionId },
        },
      ]);
      const [ticket] = await client.sendPushNotificationsAsync(chunks[0]);
      if (!ticket) throw new DeliveryError('EXPO_EMPTY_TICKET', true);
      if (ticket.status === 'error') expoFailure(ticket);
      return { kind: 'receipt', id: ticket.id };
    });
  }
  async receipt(id: string): Promise<SendResult> {
    return this.request(async (client) => {
      const [chunk] = client.chunkPushNotificationReceiptIds([id]);
      const results = await client.getPushNotificationReceiptsAsync(chunk);
      const result = results[id];
      if (!result) return { kind: 'pending' };
      if (result.status === 'error') expoFailure(result);
      return { kind: 'sent' };
    });
  }
}
