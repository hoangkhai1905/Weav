import type { UserProfile } from '../../domain/auth/auth.types';
import type { Workspace, WorkspaceMember } from '../../domain/workspace/workspace.types';

export const MOCK_USER: UserProfile = {
  id: 'user-001',
  name: 'Nguyễn Anh Xuân Trường',
  email: 'truong@example.com',
  avatar: null,
};

export const MOCK_WORKSPACE: Workspace = {
  id: 'ws-main',
  name: 'WEAV Production Workspace',
  createdBy: 'user-001',
  updatedAt: '2026-08-01T00:00:00Z',
  description: 'Primary AI Workflow Automation Hub',
  ownerName: 'Nguyễn Anh Xuân Trường',
  createdAt: '2026-08-01T00:00:00Z',
  memberCount: 3,
};

export const MOCK_MEMBERS: WorkspaceMember[] = [
  { id: 'user-001', name: 'Nguyễn Anh Xuân Trường', displayName: 'Nguyễn Anh Xuân Trường', email: 'truong@example.com', role: 'OWNER', canPublishWorkflow: true, canManageWorkflowState: true, active: true, joinedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' },
  { id: 'user-002', name: 'Lê Văn Nam', displayName: 'Lê Văn Nam', email: 'nam.le@example.com', role: 'MEMBER', canPublishWorkflow: true, canManageWorkflowState: false, active: true, joinedAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z' },
  { id: 'user-003', name: 'Trần Thị Bích', displayName: 'Trần Thị Bích', email: 'bich.tran@example.com', role: 'MEMBER', canPublishWorkflow: false, canManageWorkflowState: false, active: true, joinedAt: '2026-08-14T00:00:00Z', updatedAt: '2026-08-14T00:00:00Z' },
];
