export type WorkspaceRole = 'OWNER' | 'MEMBER';

export interface PageResult<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface WorkspaceListQuery {
  search?: string;
  role?: WorkspaceRole;
  page?: number;
  size?: number;
  sort?: 'name' | 'createdAt' | 'updatedAt';
  direction?: 'asc' | 'desc';
}

export interface WorkspaceMemberListQuery {
  search?: string;
  role?: WorkspaceRole;
  canPublishWorkflow?: boolean;
  canManageWorkflowState?: boolean;
  page?: number;
  size?: number;
  sort?: 'displayName' | 'joinedAt' | 'role';
  direction?: 'asc' | 'desc';
}

export interface WorkspaceMember {
  id: string;
  name: string;
  displayName: string | null;
  email: string;
  role: WorkspaceRole;
  canPublishWorkflow: boolean;
  canManageWorkflowState: boolean;
  active: boolean;
  joinedAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  name?: string | null;
}

export interface RenameWorkspaceInput {
  name: string;
}

export interface AddWorkspaceMemberInput {
  email: string;
}

export interface UpdateWorkspaceMemberPermissionsInput {
  canPublishWorkflow: boolean;
  canManageWorkflowState: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
  ownerName?: string;
  memberCount?: number;
}

export interface WorkspaceRepository {
  listWorkspaces(
    query?: WorkspaceListQuery,
    signal?: AbortSignal,
  ): Promise<PageResult<Workspace>>;
  getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<Workspace>;
  createWorkspace(
    input: CreateWorkspaceInput,
    signal?: AbortSignal,
  ): Promise<Workspace>;
  renameWorkspace(
    workspaceId: string,
    input: RenameWorkspaceInput,
    signal?: AbortSignal,
  ): Promise<Workspace>;
  getMembers(
    workspaceId: string,
    query?: WorkspaceMemberListQuery,
    signal?: AbortSignal,
  ): Promise<PageResult<WorkspaceMember>>;
  addMember(
    workspaceId: string,
    input: AddWorkspaceMemberInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceMember>;
  updateMemberPermissions(
    workspaceId: string,
    userId: string,
    input: UpdateWorkspaceMemberPermissionsInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceMember>;
  removeMember(
    workspaceId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  leaveWorkspace(workspaceId: string, signal?: AbortSignal): Promise<void>;
}
