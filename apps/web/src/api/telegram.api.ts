import { delay } from './client';

export interface TelegramStatus {
  connected: boolean;
  botUsername: string;
  botId: string;
  linkedAccount: string | null;
  activityLogs: Array<{
    id: string;
    timestamp: string;
    message: string;
    direction: 'INCOMING' | 'OUTGOING';
  }>;
}

export const telegramApi = {
  async getStatus(): Promise<TelegramStatus> {
    await delay(200);
    return {
      connected: true,
      botUsername: '@weav_automation_bot',
      botId: 'bot-889123',
      linkedAccount: '@truong_dev',
      activityLogs: [
        { id: 't1', timestamp: '2026-08-28 11:15:04', message: 'Command /run wf-001 executed by @truong_dev', direction: 'INCOMING' },
        { id: 't2', timestamp: '2026-08-28 11:15:05', message: 'Bot reply: Workflow execution started (ID: exec-101)', direction: 'OUTGOING' },
        { id: 't3', timestamp: '2026-08-27 18:00:03', message: 'Automated alert sent to @weav_exec_team', direction: 'OUTGOING' },
      ],
    };
  },

  async unlink(): Promise<void> {
    await delay(250);
  },

  async link(_telegramHandle: string): Promise<void> {
    void _telegramHandle;
    await delay(250);
  },
};
