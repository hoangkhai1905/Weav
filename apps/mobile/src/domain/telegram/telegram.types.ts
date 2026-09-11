export interface TelegramActivityLog {
  id: string;
  timestamp: string;
  direction: 'INCOMING' | 'OUTGOING';
  message: string;
}

export interface TelegramStatus {
  connected: boolean;
  botUsername: string;
  linkedAccount: string;
  activityLogs: TelegramActivityLog[];
}

export interface TelegramRepository {
  getStatus(): Promise<TelegramStatus>;
  createLinkCode(): Promise<{ code: string; expiresAt: string }>;
  unlink(): Promise<void>;
}
