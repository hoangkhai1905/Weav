import type { WorkspaceRepository, Workspace, WorkspaceMember } from '../../domain/workspace/workspace.types';
import { httpClient, normalizeApiError } from './http-client';

export class HttpWorkspaceRepository implements WorkspaceRepository {
  async getWorkspace(): Promise<Workspace> {
    try {
      const res = await httpClient.get<Workspace>('/api/workspaces/current');
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async getMembers(): Promise<WorkspaceMember[]> {
    try {
      const res = await httpClient.get<WorkspaceMember[]>('/api/workspaces/current/members');
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }
}
