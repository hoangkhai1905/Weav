export type ConnectionProvider = 'gmail' | 'sheets' | 'telegram' | 'http';
export type ConnectionStatus = 'CONNECTED' | 'EXPIRED' | 'DISCONNECTED';

export interface ConnectionItem {
  id: string;
  provider: ConnectionProvider;
  name: string;
  status: ConnectionStatus;
  createdBy: string;
  createdAt: string;
  lastRunAt?: string;
}

export interface ConnectionRepository {
  getConnections(): Promise<ConnectionItem[]>;
  getConnection(id: string): Promise<ConnectionItem | null>;
  testConnection(id: string): Promise<{ success: boolean; message: string; latencyMs: number }>;
}
