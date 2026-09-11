import { delay, getStorage, setStorage, STORAGE_KEYS } from './client';
import type { ConnectionItem } from '../types/workflow.types';

export const connectionApi = {
  async getConnections(): Promise<ConnectionItem[]> {
    await delay(200);
    return getStorage<ConnectionItem[]>(STORAGE_KEYS.CONNECTIONS, []);
  },

  async testConnection(_id: string): Promise<{ success: boolean; message: string }> {
    void _id;
    await delay(400);
    return { success: true, message: 'Connection ping successful. Latency: 42ms.' };
  },

  async createConnection(provider: ConnectionItem['provider'], name: string): Promise<ConnectionItem> {
    await delay(300);
    const list = getStorage<ConnectionItem[]>(STORAGE_KEYS.CONNECTIONS, []);
    const newItem: ConnectionItem = {
      id: 'conn-' + Date.now(),
      provider,
      name,
      status: 'CONNECTED',
      createdBy: 'Nguyễn Anh Xuân Trường',
      createdAt: new Date().toISOString(),
    };
    list.unshift(newItem);
    setStorage(STORAGE_KEYS.CONNECTIONS, list);
    return newItem;
  },

  async deleteConnection(id: string): Promise<void> {
    await delay(200);
    const list = getStorage<ConnectionItem[]>(STORAGE_KEYS.CONNECTIONS, []);
    setStorage(
      STORAGE_KEYS.CONNECTIONS,
      list.filter((c) => c.id !== id)
    );
  },
};
