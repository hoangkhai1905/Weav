import axios, { type AxiosRequestConfig } from 'axios';
import type {
  PageResult,
  AddWorkspaceMemberInput,
  CreateWorkspaceInput,
  RenameWorkspaceInput,
  Workspace,
  WorkspaceListQuery,
  WorkspaceMember,
  WorkspaceMemberListQuery,
  UpdateWorkspaceMemberPermissionsInput,
  WorkspaceRepository,
} from '../../domain/workspace/workspace.types';
import { useAuthStore } from '../../stores/auth.store';
import { expirePersistedAuthSession } from '../auth/auth-session.persistence';
import { httpClient, normalizeApiError } from './http-client';
import {
  buildMemberListParams,
  buildWorkspaceListParams,
  buildWorkspaceRequest,
  mapMemberPage,
  mapWorkspacePage,
  mapWorkspaceResponse,
  buildCreateWorkspaceRequest,
  buildAddMemberRequest,
  buildLeaveWorkspaceRequest,
  buildRemoveMemberRequest,
  buildRenameWorkspaceRequest,
  buildUpdateMemberPermissionsRequest,
  mapMemberResponse,
  type GatewayMemberView,
  type GatewayPage,
  type GatewayWorkspaceResponse,
} from './workspace.http.contract';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requestWorkspace<T, R>(
  config: AxiosRequestConfig,
  map: (data: T) => R,
): Promise<R> {
  const token = useAuthStore.getState().tokens?.accessToken ?? null;
  try {
    const response = await httpClient.request<T>({
      ...config,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    return map(response.data);
  } catch (error) {
    if (axios.isCancel(error)) {
      throw { code: 'CANCELED', message: 'Workspace request canceled.' };
    }
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      if (useAuthStore.getState().tokens?.accessToken === token) {
        void expirePersistedAuthSession();
      }
      throw normalizeApiError(error);
    }
    throw normalizeApiError(error);
  }
}

function requireWorkspaceId(workspaceId: string): string {
  if (!UUID_PATTERN.test(workspaceId)) {
    throw {
      code: 'INVALID_WORKSPACE_ID',
      message: 'A valid workspace must be selected before loading workspace data.',
    };
  }
  return encodeURIComponent(workspaceId);
}

function mapWorkspacePageResponse(
  data: GatewayPage<GatewayWorkspaceResponse>,
): PageResult<Workspace> {
  assertPage(data, 'workspace');
  return mapWorkspacePage(data);
}

function mapMemberPageResponse(
  data: GatewayPage<GatewayMemberView>,
): PageResult<WorkspaceMember> {
  assertPage(data, 'member');
  return mapMemberPage(data);
}

function assertPage<T>(data: GatewayPage<T>, resource: string): void {
  if (
    !data ||
    !Array.isArray(data.items) ||
    !Number.isInteger(data.page) ||
    !Number.isInteger(data.size) ||
    !Number.isInteger(data.totalPages) ||
    !Number.isSafeInteger(data.totalElements)
  ) {
    throw {
      code: 'INVALID_RESPONSE',
      message: `Invalid ${resource} page response.`,
    };
  }
}

export class HttpWorkspaceRepository implements WorkspaceRepository {
  async listWorkspaces(
    query: WorkspaceListQuery = {},
    signal?: AbortSignal,
  ): Promise<PageResult<Workspace>> {
    const params = buildWorkspaceListParams(query);
    return requestWorkspace<GatewayPage<GatewayWorkspaceResponse>, PageResult<Workspace>>(
      buildWorkspaceRequest('/api/v1/workspaces', params, null, signal),
      mapWorkspacePageResponse,
    );
  }

  async getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<Workspace> {
    const id = requireWorkspaceId(workspaceId);
    return requestWorkspace<GatewayWorkspaceResponse, Workspace>(
      buildWorkspaceRequest(`/api/v1/workspaces/${id}`, undefined, null, signal),
      mapWorkspaceResponse,
    );
  }

  async createWorkspace(
    input: CreateWorkspaceInput,
    signal?: AbortSignal,
  ): Promise<Workspace> {
    return requestWorkspace<GatewayWorkspaceResponse, Workspace>(
      buildCreateWorkspaceRequest(input, null, signal),
      mapWorkspaceResponse,
    );
  }

  async renameWorkspace(
    workspaceId: string,
    input: RenameWorkspaceInput,
    signal?: AbortSignal,
  ): Promise<Workspace> {
    const id = requireWorkspaceId(workspaceId);
    return requestWorkspace<GatewayWorkspaceResponse, Workspace>(
      buildRenameWorkspaceRequest(id, input, null, signal),
      mapWorkspaceResponse,
    );
  }

  async getMembers(
    workspaceId: string,
    query: WorkspaceMemberListQuery = {},
    signal?: AbortSignal,
  ): Promise<PageResult<WorkspaceMember>> {
    const id = requireWorkspaceId(workspaceId);
    const params = buildMemberListParams(query);
    return requestWorkspace<GatewayPage<GatewayMemberView>, PageResult<WorkspaceMember>>(
      buildWorkspaceRequest(`/api/v1/workspaces/${id}/members`, params, null, signal),
      mapMemberPageResponse,
    );
  }

  async addMember(
    workspaceId: string,
    input: AddWorkspaceMemberInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceMember> {
    const id = requireWorkspaceId(workspaceId);
    return requestWorkspace<GatewayMemberView, WorkspaceMember>(
      buildAddMemberRequest(id, input, null, signal),
      mapMemberResponse,
    );
  }

  async updateMemberPermissions(
    workspaceId: string,
    userId: string,
    input: UpdateWorkspaceMemberPermissionsInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceMember> {
    const workspace = requireWorkspaceId(workspaceId);
    const user = requireWorkspaceId(userId);
    return requestWorkspace<GatewayMemberView, WorkspaceMember>(
      buildUpdateMemberPermissionsRequest(workspace, user, input, null, signal),
      mapMemberResponse,
    );
  }

  async removeMember(
    workspaceId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const workspace = requireWorkspaceId(workspaceId);
    const user = requireWorkspaceId(userId);
    await requestWorkspace<unknown, void>(
      buildRemoveMemberRequest(workspace, user, null, signal),
      () => undefined,
    );
  }

  async leaveWorkspace(workspaceId: string, signal?: AbortSignal): Promise<void> {
    const id = requireWorkspaceId(workspaceId);
    await requestWorkspace<unknown, void>(
      buildLeaveWorkspaceRequest(id, null, signal),
      () => undefined,
    );
  }
}
