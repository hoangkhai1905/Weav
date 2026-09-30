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
import { MOCK_MEMBERS, MOCK_WORKSPACE } from './mock-data';

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
let mockWorkspace = { ...MOCK_WORKSPACE };
let mockMembers = MOCK_MEMBERS.map((member) => ({ ...member }));

function page<T>(items: T[]): PageResult<T> {
  return {
    items,
    page: 0,
    size: items.length || 1,
    totalElements: items.length,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

export class MockWorkspaceRepository implements WorkspaceRepository {
  async listWorkspaces(_query?: WorkspaceListQuery): Promise<PageResult<Workspace>> {
    await delay(300);
    return page([{ ...mockWorkspace }]);
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    await delay(300);
    if (workspaceId !== mockWorkspace.id) {
      throw { code: 'NOT_FOUND', message: 'Workspace not found.' };
    }
    return { ...mockWorkspace };
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    await delay(300);
    const name = input.name?.trim();
    if (name !== undefined && name.length === 0) {
      throw { code: 'BAD_REQUEST', message: 'Workspace name is required.' };
    }
    const now = new Date().toISOString();
    mockWorkspace = {
      ...mockWorkspace,
      id: `mock-workspace-${Date.now()}`,
      name: name || 'My workspace 2',
      createdAt: now,
      updatedAt: now,
    };
    return { ...mockWorkspace };
  }

  async renameWorkspace(
    workspaceId: string,
    input: RenameWorkspaceInput,
  ): Promise<Workspace> {
    await delay(300);
    if (workspaceId !== mockWorkspace.id) {
      throw { code: 'NOT_FOUND', message: 'Workspace not found.' };
    }
    const name = input.name.trim();
    if (!name) {
      throw { code: 'BAD_REQUEST', message: 'Workspace name is required.' };
    }
    mockWorkspace = {
      ...mockWorkspace,
      name,
      updatedAt: new Date().toISOString(),
    };
    return { ...mockWorkspace };
  }

  async getMembers(
    workspaceId: string,
    _query?: WorkspaceMemberListQuery,
  ): Promise<PageResult<WorkspaceMember>> {
    await delay(350);
    if (workspaceId !== mockWorkspace.id) {
      throw { code: 'NOT_FOUND', message: 'Workspace not found.' };
    }
    return page(mockMembers.map((member) => ({ ...member })));
  }

  async addMember(
    workspaceId: string,
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    await delay(300);
    if (workspaceId !== mockWorkspace.id) throw { code: 'NOT_FOUND', message: 'Workspace not found.' };
    const email = input.email.trim();
    if (!email || email.length > 320) throw { code: 'BAD_REQUEST', message: 'A valid member email is required.' };
    if (mockMembers.some((member) => member.email.toLowerCase() === email.toLowerCase())) {
      throw { code: 'CONFLICT', message: 'This user is already a workspace member.' };
    }
    const now = new Date().toISOString();
    const member: WorkspaceMember = {
      id: `mock-member-${Date.now()}`,
      name: email,
      displayName: null,
      email,
      role: 'MEMBER',
      canPublishWorkflow: false,
      canManageWorkflowState: false,
      active: true,
      joinedAt: now,
      updatedAt: now,
    };
    mockMembers = [...mockMembers, member];
    return { ...member };
  }

  async updateMemberPermissions(
    workspaceId: string,
    userId: string,
    input: UpdateWorkspaceMemberPermissionsInput,
  ): Promise<WorkspaceMember> {
    await delay(300);
    if (workspaceId !== mockWorkspace.id) throw { code: 'NOT_FOUND', message: 'Workspace not found.' };
    const member = mockMembers.find((candidate) => candidate.id === userId);
    if (!member) throw { code: 'NOT_FOUND', message: 'Member not found.' };
    if (member.role === 'OWNER') throw { code: 'FORBIDDEN', message: 'Owner permissions cannot be changed.' };
    const updated = { ...member, ...input, updatedAt: new Date().toISOString() };
    mockMembers = mockMembers.map((candidate) => candidate.id === userId ? updated : candidate);
    return { ...updated };
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await delay(300);
    if (workspaceId !== mockWorkspace.id) throw { code: 'NOT_FOUND', message: 'Workspace not found.' };
    const member = mockMembers.find((candidate) => candidate.id === userId);
    if (!member) throw { code: 'NOT_FOUND', message: 'Member not found.' };
    if (member.role === 'OWNER') throw { code: 'FORBIDDEN', message: 'The workspace owner cannot be removed.' };
    mockMembers = mockMembers.filter((candidate) => candidate.id !== userId);
  }

  async leaveWorkspace(_workspaceId: string): Promise<void> {
    await delay(300);
    throw { code: 'MOCK_UNSUPPORTED', message: 'Leaving a workspace is unavailable in explicit mock mode.' };
  }
}
