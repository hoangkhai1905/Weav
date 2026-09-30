import axios, { type AxiosRequestConfig } from 'axios';
import { delay, getStorage, setStorage, STORAGE_KEYS } from './client';
import { getStoredAuthToken } from './ocr.api';
import { useAuthStore } from '../store/useAuthStore';
import type { WorkspaceMember } from '../types/workflow.types';

export const isWorkspaceMockMode = import.meta.env.VITE_API_MODE === 'mock';

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceListQuery {
  search?: string;
  role?: 'OWNER' | 'MEMBER';
  page?: number;
  size?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
}

export interface WorkspaceMemberQuery {
  search?: string;
  role?: 'OWNER' | 'MEMBER';
  canPublishWorkflow?: boolean;
  canManageWorkflowState?: boolean;
  page?: number;
  size?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
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

export interface WorkspacePage {
  items: WorkspaceSummary[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface WorkspaceMemberPage {
  items: WorkspaceMember[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

interface WorkspaceResponse {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface MemberView {
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

interface PageResult<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
  requestId?: string;
}

export class WorkspaceApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, retryable = false, requestId?: string) {
    super(message);
    this.name = 'WorkspaceApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

const workspaceHttpClient = axios.create({
  baseURL: (
    import.meta.env.VITE_API_GATEWAY_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, ''),
  timeout: 10000,
});

let mockWorkspaces: WorkspaceSummary[] = [
  {
    id: 'ws-main',
    name: 'WEAV Production Workspace',
    createdBy: 'user-001',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

function statusMessage(status: number): { code: string; message: string; retryable: boolean } {
  switch (status) {
    case 400:
      return { code: 'INVALID_REQUEST', message: 'Please check the workspace details and try again.', retryable: false };
    case 401:
      return { code: 'UNAUTHENTICATED', message: 'Please sign in again.', retryable: false };
    case 403:
      return { code: 'FORBIDDEN', message: 'Workspace access denied.', retryable: false };
    case 404:
      return { code: 'WORKSPACE_NOT_FOUND', message: 'This workspace no longer exists or you no longer have access to it.', retryable: false };
    case 409:
      return { code: 'CONFLICT', message: 'A workspace with these details already exists.', retryable: false };
    case 422:
      return { code: 'VALIDATION_FAILED', message: 'Please check the workspace details and try again.', retryable: false };
    case 429:
      return { code: 'RATE_LIMITED', message: 'Workspace service is rate limited. Please try again shortly.', retryable: true };
    default:
      return { code: 'WORKSPACE_UNAVAILABLE', message: 'Workspace service is temporarily unavailable.', retryable: status >= 500 || status === 0 };
  }
}

export function validateWorkspaceName(name: string, required: boolean): string | null {
  const normalized = name.trim();
  if (required && !normalized) return 'Workspace name is required.';
  if (normalized.length > 255) return 'Workspace name must be 255 characters or fewer.';
  return null;
}

export function validateWorkspaceMemberEmail(email: string): string | null {
  const normalized = email.trim();
  if (!normalized) return 'An existing Identity user email is required.';
  if (normalized.length > 320) return 'Email must be 320 characters or fewer.';
  return null;
}

async function requestWorkspace<T>(config: AxiosRequestConfig): Promise<T> {
  const token = getStoredAuthToken();
  if (!token) {
    const fallback = statusMessage(401);
    throw new WorkspaceApiError(401, fallback.code, fallback.message, fallback.retryable);
  }

  try {
    const response = await workspaceHttpClient.request<T>({
      ...config,
      headers: {
        ...(config.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status ?? 0 : 0;
    const envelope = axios.isAxiosError(error)
      ? (error.response?.data as ApiErrorEnvelope | undefined)
      : undefined;
    const fallback = statusMessage(status);

    if (status === 401 && getStoredAuthToken() === token) {
      useAuthStore.getState().logout();
    }

    throw new WorkspaceApiError(
      status,
      envelope?.error?.code ?? fallback.code,
      envelope?.error?.message ?? fallback.message,
      envelope?.error?.retryable ?? fallback.retryable,
      envelope?.requestId,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePageResult<T>(value: unknown, mapItem: (item: unknown) => T): PageResult<T> {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.page !== 'number' ||
    typeof value.size !== 'number' ||
    typeof value.totalElements !== 'number' ||
    typeof value.totalPages !== 'number'
  ) {
    throw new WorkspaceApiError(502, 'INVALID_RESPONSE', 'Workspace service returned an invalid page response.');
  }

  return {
    items: value.items.map(mapItem),
    page: value.page,
    size: value.size,
    totalElements: value.totalElements,
    totalPages: value.totalPages,
  };
}

function mapWorkspace(value: unknown): WorkspaceSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.createdBy !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new WorkspaceApiError(502, 'INVALID_RESPONSE', 'Workspace service returned an invalid workspace.');
  }

  return {
    id: value.id,
    name: value.name,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function mapMember(value: unknown): WorkspaceMember {
  if (
    !isRecord(value) ||
    typeof value.userId !== 'string' ||
    typeof value.email !== 'string' ||
    (typeof value.displayName !== 'string' && value.displayName !== null) ||
    typeof value.active !== 'boolean' ||
    (value.role !== 'OWNER' && value.role !== 'MEMBER') ||
    typeof value.canPublishWorkflow !== 'boolean' ||
    typeof value.canManageWorkflowState !== 'boolean' ||
    typeof value.joinedAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new WorkspaceApiError(502, 'INVALID_RESPONSE', 'Workspace service returned an invalid member.');
  }

  return {
    id: value.userId,
    name: value.displayName?.trim() || value.email,
    email: value.email,
    role: value.role,
    canPublishWorkflow: value.canPublishWorkflow,
    canManageWorkflowState: value.canManageWorkflowState,
    joinedAt: value.joinedAt,
  };
}

function withPageDefaults(query: WorkspaceListQuery | WorkspaceMemberQuery) {
  return {
    page: query.page ?? 0,
    size: query.size ?? 20,
    ...(query.search ? { search: query.search } : {}),
    ...(query.role ? { role: query.role } : {}),
    ...('canPublishWorkflow' in query && typeof query.canPublishWorkflow === 'boolean' ? { canPublishWorkflow: query.canPublishWorkflow } : {}),
    ...('canManageWorkflowState' in query && typeof query.canManageWorkflowState === 'boolean' ? { canManageWorkflowState: query.canManageWorkflowState } : {}),
    ...(query.sort ? { sort: query.sort } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
  };
}

export const workspaceApi = {
  async listWorkspaces(query: WorkspaceListQuery = {}, signal?: AbortSignal): Promise<WorkspacePage> {
    if (!isWorkspaceMockMode) {
      const page = await requestWorkspace<PageResult<WorkspaceResponse>>({
        method: 'GET',
        url: '/api/v1/workspaces',
        params: withPageDefaults(query),
        signal,
      });
      return parsePageResult(page, mapWorkspace);
    }

    await delay(150);
    const filtered = query.search
      ? mockWorkspaces.filter((item) => item.name.toLowerCase().includes(query.search!.toLowerCase()))
      : mockWorkspaces;
    return {
      items: filtered,
      page: 0,
      size: query.size ?? 20,
      totalElements: filtered.length,
      totalPages: filtered.length ? 1 : 0,
    };
  },

  async getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceSummary> {
    if (!isWorkspaceMockMode) {
      const workspace = await requestWorkspace<WorkspaceResponse>({
        method: 'GET',
        url: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`,
        signal,
      });
      return mapWorkspace(workspace);
    }

    await delay(100);
    const workspace = mockWorkspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new WorkspaceApiError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    return workspace;
  },

  async createWorkspace(name?: string | null, signal?: AbortSignal): Promise<WorkspaceSummary> {
    if (!isWorkspaceMockMode) {
      const body: CreateWorkspaceInput = name === undefined ? {} : { name };
      const workspace = await requestWorkspace<WorkspaceResponse>({
        method: 'POST',
        url: '/api/v1/workspaces',
        data: body,
        signal,
      });
      return mapWorkspace(workspace);
    }

    await delay(150);
    const nextNumber = mockWorkspaces.length + 1;
    const trimmedName = name?.trim();
    const now = new Date().toISOString();
    const workspace: WorkspaceSummary = {
      id: `ws-${Date.now()}`,
      name: trimmedName || `My workspace ${nextNumber}`,
      createdBy: 'user-001',
      createdAt: now,
      updatedAt: now,
    };
    mockWorkspaces = [...mockWorkspaces, workspace];
    return workspace;
  },

  async renameWorkspace(
    workspaceId: string,
    input: RenameWorkspaceInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceSummary> {
    if (!isWorkspaceMockMode) {
      const workspace = await requestWorkspace<WorkspaceResponse>({
        method: 'PATCH',
        url: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`,
        data: input,
        signal,
      });
      return mapWorkspace(workspace);
    }

    await delay(150);
    const index = mockWorkspaces.findIndex((item) => item.id === workspaceId);
    if (index === -1) throw new WorkspaceApiError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    const workspace = {
      ...mockWorkspaces[index],
      name: input.name.trim(),
      updatedAt: new Date().toISOString(),
    };
    mockWorkspaces = mockWorkspaces.map((item, itemIndex) => itemIndex === index ? workspace : item);
    return workspace;
  },

  async getMembers(
    workspaceId: string,
    query: WorkspaceMemberQuery = {},
    signal?: AbortSignal,
  ): Promise<WorkspaceMemberPage> {
    if (!isWorkspaceMockMode) {
      const page = await requestWorkspace<PageResult<MemberView>>({
        method: 'GET',
        url: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
        params: withPageDefaults(query),
        signal,
      });
      return parsePageResult(page, mapMember);
    }

    await delay(150);
    const items = getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
    return {
      items,
      page: 0,
      size: query.size ?? 20,
      totalElements: items.length,
      totalPages: items.length ? 1 : 0,
    };
  },

  async addMember(
    workspaceId: string,
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    if (!isWorkspaceMockMode) {
      const member = await requestWorkspace<MemberView>({
        method: 'POST',
        url: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
        data: { email: input.email.trim() },
      });
      return mapMember(member);
    }

    await delay(300);
    const members = getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
    const newMember: WorkspaceMember = {
      id: `user-${Date.now()}`,
      name: input.email.split('@')[0].replace('.', ' '),
      email: input.email.trim(),
      role: 'MEMBER',
      canPublishWorkflow: false,
      canManageWorkflowState: false,
      joinedAt: new Date().toISOString(),
    };
    members.push(newMember);
    setStorage(STORAGE_KEYS.MEMBERS, members);
    return newMember;
  },

  async updateMemberPermissions(
    workspaceId: string,
    memberId: string,
    input: UpdateWorkspaceMemberPermissionsInput,
  ): Promise<WorkspaceMember> {
    if (!isWorkspaceMockMode) {
      const member = await requestWorkspace<MemberView>({
        method: 'PATCH',
        url: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}/permissions`,
        data: input,
      });
      return mapMember(member);
    }

    await delay(250);
    const members = getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
    const idx = members.findIndex((member) => member.id === memberId);
    if (idx === -1) throw new WorkspaceApiError(404, 'MEMBER_NOT_FOUND', 'Member not found.');
    members[idx] = { ...members[idx], ...input };
    setStorage(STORAGE_KEYS.MEMBERS, members);
    return members[idx];
  },

  async removeMember(workspaceId: string, memberId: string): Promise<void> {
    if (!isWorkspaceMockMode) {
      await requestWorkspace<void>({
        method: 'DELETE',
        url: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
      });
      return;
    }

    await delay(200);
    const members = getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
    setStorage(STORAGE_KEYS.MEMBERS, members.filter((member) => member.id !== memberId));
  },

  async leaveWorkspace(workspaceId: string): Promise<void> {
    if (!isWorkspaceMockMode) {
      await requestWorkspace<void>({
        method: 'DELETE',
        url: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/me`,
      });
      return;
    }

    await delay(200);
    const currentUserId = useAuthStore.getState().user?.id;
    if (!currentUserId) throw new WorkspaceApiError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    const members = getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
    setStorage(STORAGE_KEYS.MEMBERS, members.filter((member) => member.id !== currentUserId));
  },
};
