import { api } from './client';

export interface AdminWorkspace {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  memberCount: number;
  createdAt: string;
}

export interface WorkspacePage {
  items: AdminWorkspace[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface ListWorkspacesParams {
  page?: number;
  size?: number;
  q?: string;
  ownerId?: string;
  ids?: string[];
}

/** Empty filters are left out of the query string. */
export const listWorkspaces = async ({ page, size, q, ownerId, ids }: ListWorkspacesParams = {}): Promise<WorkspacePage> =>
  (await api.get<WorkspacePage>('/api/admin/workspaces', {
    params: { page, size, q: q || undefined, ownerId: ownerId || undefined, ids: ids?.length ? ids.join(',') : undefined },
  })).data;
