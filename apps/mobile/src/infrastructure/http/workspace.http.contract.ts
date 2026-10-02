import type {
  PageResult,
  AddWorkspaceMemberInput,
  CreateWorkspaceInput,
  RenameWorkspaceInput,
  UpdateWorkspaceMemberPermissionsInput,
  Workspace,
  WorkspaceListQuery,
  WorkspaceMember,
  WorkspaceMemberListQuery,
} from '../../domain/workspace/workspace.types';

export interface GatewayWorkspaceResponse {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayMemberView {
  userId: string;
  email: string;
  displayName: string | null;
  active: boolean;
  role: 'OWNER' | 'MEMBER';
  canPublishWorkflow: boolean;
  canManageWorkflowState: boolean;
  joinedAt: string;
  updatedAt: string;
}

export interface GatewayPage<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface WorkspaceRequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean>;
  data?:
    | CreateWorkspaceInput
    | RenameWorkspaceInput
    | AddWorkspaceMemberInput
    | UpdateWorkspaceMemberPermissionsInput;
  headers?: { Authorization: string };
  signal?: AbortSignal;
}

function buildMutationRequest(
  method: 'POST' | 'PATCH',
  url: string,
  data:
    | CreateWorkspaceInput
    | RenameWorkspaceInput
    | AddWorkspaceMemberInput
    | UpdateWorkspaceMemberPermissionsInput,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return {
    method,
    url,
    data,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    ...(signal ? { signal } : {}),
  };
}

export function buildCreateWorkspaceRequest(
  input: CreateWorkspaceInput,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return buildMutationRequest('POST', '/api/v1/workspaces', input, token, signal);
}

export function buildRenameWorkspaceRequest(
  workspaceId: string,
  input: RenameWorkspaceInput,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return buildMutationRequest(
    'PATCH',
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`,
    input,
    token,
    signal,
  );
}

export function buildAddMemberRequest(
  workspaceId: string,
  input: AddWorkspaceMemberInput,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return buildMutationRequest(
    'POST',
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
    input,
    token,
    signal,
  );
}

export function buildUpdateMemberPermissionsRequest(
  workspaceId: string,
  userId: string,
  input: UpdateWorkspaceMemberPermissionsInput,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return buildMutationRequest(
    'PATCH',
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}/permissions`,
    input,
    token,
    signal,
  );
}

export function buildRemoveMemberRequest(
  workspaceId: string,
  userId: string,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return buildDeleteRequest(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
    token,
    signal,
  );
}

export function buildLeaveWorkspaceRequest(
  workspaceId: string,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return buildDeleteRequest(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/me`,
    token,
    signal,
  );
}

function buildDeleteRequest(
  url: string,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return {
    method: 'DELETE',
    url,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    ...(signal ? { signal } : {}),
  };
}

export function buildWorkspaceRequest(
  url: string,
  params: Record<string, string | number | boolean> | undefined,
  token: string | null,
  signal?: AbortSignal,
): WorkspaceRequestConfig {
  return {
    url,
    ...(params ? { params } : {}),
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    ...(signal ? { signal } : {}),
  };
}

export function buildWorkspaceListParams(query: WorkspaceListQuery = {}) {
  return compactParams({
    search: query.search,
    role: query.role,
    page: query.page,
    size: query.size,
    sort: query.sort,
    direction: query.direction,
  });
}

export function buildMemberListParams(query: WorkspaceMemberListQuery = {}) {
  return compactParams({
    search: query.search,
    role: query.role,
    canPublishWorkflow: query.canPublishWorkflow,
    canManageWorkflowState: query.canManageWorkflowState,
    page: query.page,
    size: query.size,
    sort: query.sort,
    direction: query.direction,
  });
}

function compactParams(
  params: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> | undefined {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function mapWorkspaceResponse(response: GatewayWorkspaceResponse): Workspace {
  if (
    !response ||
    typeof response.id !== 'string' ||
    typeof response.name !== 'string' ||
    typeof response.createdBy !== 'string' ||
    typeof response.createdAt !== 'string' ||
    typeof response.updatedAt !== 'string'
  ) {
    throw new Error('Invalid workspace response.');
  }
  return {
    id: response.id,
    name: response.name,
    createdBy: response.createdBy,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
  };
}

export function mapWorkspacePage(
  page: GatewayPage<GatewayWorkspaceResponse>,
): PageResult<Workspace> {
  return {
    items: page.items.map(mapWorkspaceResponse),
    page: page.page,
    size: page.size,
    totalElements: page.totalElements,
    totalPages: page.totalPages,
  };
}

export function mapMemberPage(
  page: GatewayPage<GatewayMemberView>,
): PageResult<WorkspaceMember> {
  return {
    items: page.items.map(mapMemberResponse),
    page: page.page,
    size: page.size,
    totalElements: page.totalElements,
    totalPages: page.totalPages,
  };
}

export function mapMemberResponse(member: GatewayMemberView): WorkspaceMember {
  if (
    !member ||
    typeof member.userId !== 'string' ||
    typeof member.email !== 'string' ||
    (member.displayName !== null && typeof member.displayName !== 'string') ||
    typeof member.active !== 'boolean' ||
    (member.role !== 'OWNER' && member.role !== 'MEMBER') ||
    typeof member.canPublishWorkflow !== 'boolean' ||
    typeof member.canManageWorkflowState !== 'boolean' ||
    typeof member.joinedAt !== 'string' ||
    typeof member.updatedAt !== 'string'
  ) {
    throw new Error('Invalid member response.');
  }
  return {
    id: member.userId,
    name: member.displayName?.trim() || member.email,
    displayName: member.displayName,
    email: member.email,
    role: member.role,
    canPublishWorkflow: member.canPublishWorkflow,
    canManageWorkflowState: member.canManageWorkflowState,
    active: member.active,
    joinedAt: member.joinedAt,
    updatedAt: member.updatedAt,
  };
}
