import type { ConnectionRepository, ConnectionItem } from '../../domain/connection/connection.types';
import { MOCK_CONNECTIONS } from './mock-data';

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockConnectionRepository implements ConnectionRepository {
  async getConnections(): Promise<ConnectionItem[]> {
    await delay(300);
    return [...MOCK_CONNECTIONS];
  }

  async getConnection(id: string): Promise<ConnectionItem | null> {
    await delay(250);
    const conn = MOCK_CONNECTIONS.find((c) => c.id === id);
    return conn ? { ...conn } : null;
  }

  async testConnection(id: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    await delay(450);
    const conn = MOCK_CONNECTIONS.find((c) => c.id === id);
    if (!conn) throw new Error('Connection credential not found');

    if (conn.status === 'EXPIRED') {
      return { success: false, message: 'OAuth credential token expired. Please re-authenticate on Web.', latencyMs: 820 };
    }

    return {
      success: true,
      message: `Connection ping to ${conn.provider.toUpperCase()} successful. Latency: 42ms. HTTP 200 OK.`,
      latencyMs: 42,
    };
  }
}
