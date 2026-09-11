import type { WorkspaceRepository, Workspace, WorkspaceMember } from '../../domain/workspace/workspace.types';
import { MOCK_WORKSPACE, MOCK_MEMBERS } from './mock-data';

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockWorkspaceRepository implements WorkspaceRepository {
  async getWorkspace(): Promise<Workspace> {
    await delay(300);
    return { ...MOCK_WORKSPACE };
  }

  async getMembers(): Promise<WorkspaceMember[]> {
    await delay(350);
    return [...MOCK_MEMBERS];
  }
}
