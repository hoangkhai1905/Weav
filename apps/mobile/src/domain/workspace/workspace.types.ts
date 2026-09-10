export type WorkspaceRole = 'OWNER' | 'MEMBER';

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  canPublishWorkflow: boolean;
  joinedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  ownerName: string;
  createdAt: string;
  memberCount: number;
}

export interface WorkspaceRepository {
  getWorkspace(): Promise<Workspace>;
  getMembers(): Promise<WorkspaceMember[]>;
}
