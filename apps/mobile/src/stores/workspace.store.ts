import { create } from 'zustand';
import type { Workspace } from '../domain/workspace/workspace.types';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  workspaceAccessError: string | null;
  setWorkspaces: (workspaces: Workspace[]) => void;
  selectWorkspace: (workspaceId: string) => void;
  removeWorkspace: (workspaceId: string) => void;
  markWorkspaceUnavailable: (workspaceId: string, message: string) => void;
  clearWorkspaceSession: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  workspaceAccessError: null,
  setWorkspaces: (workspaces) =>
    set((state) => {
      const activeStillExists = state.activeWorkspaceId
        ? workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)
        : false;
      const nextActiveWorkspaceId = activeStillExists
        ? state.activeWorkspaceId
        : state.workspaceAccessError
          ? null
          : workspaces[0]?.id ?? null;
      return { workspaces, activeWorkspaceId: nextActiveWorkspaceId };
    }),
  selectWorkspace: (workspaceId) =>
    set((state) => {
      const exists = state.workspaces.some((workspace) => workspace.id === workspaceId);
      return exists
        ? { activeWorkspaceId: workspaceId, workspaceAccessError: null }
        : {
            activeWorkspaceId: null,
            workspaceAccessError: 'This workspace is no longer available to your account.',
        };
    }),
  removeWorkspace: (workspaceId) =>
    set((state) => {
      const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
      const activeWorkspaceId =
        state.activeWorkspaceId === workspaceId
          ? workspaces[0]?.id ?? null
          : state.activeWorkspaceId;
      return { workspaces, activeWorkspaceId, workspaceAccessError: null };
    }),
  markWorkspaceUnavailable: (workspaceId, message) =>
    set((state) => ({
      activeWorkspaceId:
        state.activeWorkspaceId === workspaceId ? null : state.activeWorkspaceId,
      workspaceAccessError: message,
    })),
  clearWorkspaceSession: () =>
    set({ workspaces: [], activeWorkspaceId: null, workspaceAccessError: null }),
}));

export const selectActiveWorkspace = (state: WorkspaceState): Workspace | null =>
  state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null;
