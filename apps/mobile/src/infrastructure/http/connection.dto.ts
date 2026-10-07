/** Raw gateway JSON for /api/v1/workspaces/{ws}/connections (workspace-service). */
export interface ConnectionResponseDto {
  id: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  provider: string;
  authType: string;
  status: string;
  config: Record<string, unknown> | null;
  hasCredential: boolean;
  credentialExpiresAt: string | null;
  lastVerifiedAt: string | null;
  canManage: boolean;
  canAttach: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The list is a plain array, not a page. */
export type ConnectionListDto = ConnectionResponseDto[];

export interface ConnectionTestResultDto {
  outcome: string;
}
