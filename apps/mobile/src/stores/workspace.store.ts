import { create } from 'zustand';
import type { Workspace } from '../domain/workspace/workspace.types';

interface WorkspaceState {
  activeWorkspace: Workspace;
  setActiveWorkspace: (workspace: Workspace) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspace: {
    id: 'ws-main',
    name: 'WEAV Production Workspace',
    description: 'Primary AI Workflow Automation Hub',
    ownerName: 'Nguyễn Anh Xuân Trường',
    createdAt: '2026-08-01T00:00:00Z',
    memberCount: 3,
  },
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
}));
