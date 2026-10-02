import type { TelegramRepository, TelegramStatus } from '../../domain/telegram/telegram.types';
import { httpClient, normalizeApiError } from './http-client';

export class HttpTelegramRepository implements TelegramRepository {
  async getStatus(): Promise<TelegramStatus> {
    try {
      const res = await httpClient.get<TelegramStatus>('/api/telegram/status');
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async createLinkCode(): Promise<{ code: string; expiresAt: string }> {
    try {
      const res = await httpClient.post<{ code: string; expiresAt: string }>('/api/telegram/link-code');
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async unlink(): Promise<void> {
    try {
      await httpClient.post('/api/telegram/unlink');
    } catch (err) {
      throw normalizeApiError(err);
    }
  }
}
