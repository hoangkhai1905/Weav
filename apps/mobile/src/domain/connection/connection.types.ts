export type ConnectionProvider =
  | 'GMAIL'
  | 'GOOGLE_SHEETS'
  | 'GOOGLE_CALENDAR'
  | 'GOOGLE_DRIVE'
  | 'TELEGRAM'
  | 'HTTP';
export type ConnectionAuthType = 'NONE' | 'TOKEN' | 'API_KEY' | 'BASIC' | 'OAUTH2';
export type ConnectionStatus = 'ACTIVE' | 'INVALID' | 'DISABLED';
export type ConnectionTestOutcome = 'VERIFIED' | 'AUTH_INVALID' | 'DEPENDENCY_FAILURE';

export interface ConnectionItem {
  id: string;
  workspaceId: string;
  /** User id (uuid), not a display name. */
  createdBy: string;
  name: string;
  provider: ConnectionProvider;
  authType: ConnectionAuthType;
  status: ConnectionStatus;
  config: Record<string, unknown> | null;
  hasCredential: boolean;
  credentialExpiresAt: string | null;
  lastVerifiedAt: string | null;
  canManage: boolean;
  canAttach: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionRepository {
  getConnections(workspaceId: string): Promise<ConnectionItem[]>;
  getConnection(workspaceId: string, connectionId: string): Promise<ConnectionItem>;
  testConnection(workspaceId: string, connectionId: string): Promise<ConnectionTestOutcome>;
  disableConnection(workspaceId: string, connectionId: string): Promise<ConnectionItem>;
}
