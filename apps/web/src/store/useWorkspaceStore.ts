import { create } from 'zustand';
import type { WorkspaceSummary } from '../api/workspace.api';

interface WorkspaceState {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  workspaceAccessError: string | null;
  setWorkspaces: (workspaces: WorkspaceSummary[]) => void;
  selectWorkspace: (workspaceId: string | null) => void;
  removeWorkspace: (workspaceId: string, reason?: string) => void;
  clear: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  workspaceAccessError: null,
  setWorkspaces: (workspaces) =>
    set((state) => {
      const activeStillExists = state.activeWorkspaceId && workspaces.some((workspace) => workspace.id === state.activeWorkspaceId);
      return {
        workspaces,
        activeWorkspaceId: activeStillExists ? state.activeWorkspaceId : workspaces[0]?.id ?? null,
      };
    }),
  selectWorkspace: (workspaceId) =>
    set((state) => ({
      activeWorkspaceId:
        workspaceId && state.workspaces.some((workspace) => workspace.id === workspaceId)
          ? workspaceId
          : null,
      workspaceAccessError: null,
    })),
  removeWorkspace: (workspaceId, reason) =>
    set((state) => ({
      workspaces: state.workspaces.filter((workspace) => workspace.id !== workspaceId),
      activeWorkspaceId: state.activeWorkspaceId === workspaceId ? null : state.activeWorkspaceId,
      workspaceAccessError: reason ?? state.workspaceAccessError,
    })),
  clear: () => set({ workspaces: [], activeWorkspaceId: null, workspaceAccessError: null }),
}));
