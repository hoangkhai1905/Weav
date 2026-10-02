import type { ConnectionRepository, ConnectionItem } from '../../domain/connection/connection.types';
import { httpClient, normalizeApiError } from './http-client';

export class HttpConnectionRepository implements ConnectionRepository {
  async getConnections(): Promise<ConnectionItem[]> {
    try {
      const res = await httpClient.get<ConnectionItem[]>('/api/connections');
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async getConnection(id: string): Promise<ConnectionItem | null> {
    try {
      const res = await httpClient.get<ConnectionItem>(`/api/connections/${id}`);
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async testConnection(id: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    try {
      const res = await httpClient.post<{ success: boolean; message: string; latencyMs: number }>(`/api/connections/${id}/test`);
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }
}
