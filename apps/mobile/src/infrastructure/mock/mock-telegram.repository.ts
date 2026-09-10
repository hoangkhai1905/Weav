import type { TelegramRepository, TelegramStatus } from '../../domain/telegram/telegram.types';
import { MOCK_TELEGRAM_STATUS } from './mock-data';

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

let statusStore = { ...MOCK_TELEGRAM_STATUS };

export class MockTelegramRepository implements TelegramRepository {
  async getStatus(): Promise<TelegramStatus> {
    await delay(300);
    return { ...statusStore };
  }

  async createLinkCode(): Promise<{ code: string; expiresAt: string }> {
    await delay(350);
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toLocaleTimeString();
    return { code: randomCode, expiresAt };
  }

  async unlink(): Promise<void> {
    await delay(300);
    statusStore = {
      connected: false,
      botUsername: '@weav_automation_bot',
      linkedAccount: '',
      activityLogs: [],
    };
  }
}
