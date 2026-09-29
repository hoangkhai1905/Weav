import { create } from 'zustand';
import type { WorkspaceSummary } from '../api/workspace.api';

interface WorkspaceState {
  workspaces: WorkspaceSummary[];
  canonicalWorkspaces: WorkspaceSummary[];
  workspaceListSessionKey: string | null;
  notificationTargetWorkspace: { sessionKey: string; workspace: WorkspaceSummary } | null;
  activeWorkspaceId: string | null;
  workspaceAccessError: string | null;
  setWorkspaces: (workspaces: WorkspaceSummary[]) => void;
  reconcileWorkspaceList: (workspaces: WorkspaceSummary[], sessionKey: string) => void;
  authorizeNotificationTargetWorkspace: (sessionKey: string, workspace: WorkspaceSummary) => void;
  revokeNotificationTargetWorkspace: (sessionKey: string, workspaceId: string) => void;
  selectWorkspace: (workspaceId: string | null) => void;
  removeWorkspace: (workspaceId: string, reason?: string) => void;
  clear: () => void;
}

function withNotificationTarget(
  workspaces: WorkspaceSummary[],
  target: WorkspaceState['notificationTargetWorkspace'],
  sessionKey: string | null,
) {
  if (!target || target.sessionKey !== sessionKey || workspaces.some((workspace) => workspace.id === target.workspace.id)) {
    return workspaces;
  }
  return [...workspaces, target.workspace];
}

function retainOrChooseActiveWorkspace(
  activeWorkspaceId: string | null,
  visibleWorkspaces: WorkspaceSummary[],
  fallbackWorkspaceIds: Array<string | null>,
) {
  if (activeWorkspaceId && visibleWorkspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
    return activeWorkspaceId;
  }
  return fallbackWorkspaceIds.find((id) => id && visibleWorkspaces.some((workspace) => workspace.id === id)) ?? null;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  canonicalWorkspaces: [],
  workspaceListSessionKey: null,
  notificationTargetWorkspace: null,
  activeWorkspaceId: null,
  workspaceAccessError: null,
  setWorkspaces: (workspaces) =>
    set((state) => {
      const target = state.notificationTargetWorkspace?.sessionKey === state.workspaceListSessionKey
        ? state.notificationTargetWorkspace
        : null;
      const targetWorkspace = target
        ? workspaces.find((workspace) => workspace.id === target.workspace.id) ?? target.workspace
        : null;
      const notificationTargetWorkspace = target && targetWorkspace
        ? { ...target, workspace: targetWorkspace }
        : null;
      const canonicalWorkspaces = notificationTargetWorkspace
        ? workspaces.filter((workspace) => workspace.id !== notificationTargetWorkspace.workspace.id)
        : workspaces;
      const visibleWorkspaces = withNotificationTarget(
        canonicalWorkspaces,
        notificationTargetWorkspace,
        state.workspaceListSessionKey,
      );
      return {
        canonicalWorkspaces,
        notificationTargetWorkspace,
        workspaces: visibleWorkspaces,
        activeWorkspaceId: retainOrChooseActiveWorkspace(
          state.activeWorkspaceId,
          visibleWorkspaces,
          [canonicalWorkspaces[0]?.id ?? null, notificationTargetWorkspace?.workspace.id ?? null],
        ),
      };
    }),
  reconcileWorkspaceList: (canonicalWorkspaces, sessionKey) =>
    set((state) => {
      const target = state.notificationTargetWorkspace?.sessionKey === sessionKey
        ? state.notificationTargetWorkspace
        : null;
      const visibleWorkspaces = withNotificationTarget(canonicalWorkspaces, target, sessionKey);
      return {
        canonicalWorkspaces,
        workspaceListSessionKey: sessionKey,
        notificationTargetWorkspace: target,
        workspaces: visibleWorkspaces,
        activeWorkspaceId: retainOrChooseActiveWorkspace(
          state.activeWorkspaceId,
          visibleWorkspaces,
          [canonicalWorkspaces[0]?.id ?? null, target?.workspace.id ?? null],
        ),
      };
    }),
  authorizeNotificationTargetWorkspace: (sessionKey, workspace) =>
    set((state) => {
      const canonicalWorkspaces = state.workspaceListSessionKey === sessionKey
        ? state.canonicalWorkspaces
        : [];
      const visibleWorkspaces = withNotificationTarget(
        canonicalWorkspaces,
        { sessionKey, workspace },
        sessionKey,
      );
      return {
        canonicalWorkspaces,
        workspaceListSessionKey: sessionKey,
        notificationTargetWorkspace: { sessionKey, workspace },
        workspaces: visibleWorkspaces,
        activeWorkspaceId: retainOrChooseActiveWorkspace(
          state.activeWorkspaceId,
          visibleWorkspaces,
          [canonicalWorkspaces[0]?.id ?? null, workspace.id],
        ),
      };
    }),
  revokeNotificationTargetWorkspace: (sessionKey, workspaceId) =>
    set((state) => {
      if (
        state.notificationTargetWorkspace?.sessionKey !== sessionKey ||
        state.notificationTargetWorkspace.workspace.id !== workspaceId
      ) return state;
      const canonicalWorkspaces = state.canonicalWorkspaces.filter((workspace) => workspace.id !== workspaceId);
      return {
        canonicalWorkspaces,
        notificationTargetWorkspace: null,
        workspaces: canonicalWorkspaces,
        activeWorkspaceId: retainOrChooseActiveWorkspace(
          state.activeWorkspaceId,
          canonicalWorkspaces,
          [canonicalWorkspaces[0]?.id ?? null],
        ),
      };
    }),
  selectWorkspace: (workspaceId) =>
    set((state) => {
      const requestedWorkspaceId = workspaceId && state.workspaces.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : null;
      const target = requestedWorkspaceId === state.notificationTargetWorkspace?.workspace.id
        ? state.notificationTargetWorkspace
        : null;
      const visibleWorkspaces = withNotificationTarget(state.canonicalWorkspaces, target, state.workspaceListSessionKey);
      const selectedWorkspaceId = requestedWorkspaceId && visibleWorkspaces.some((workspace) => workspace.id === requestedWorkspaceId)
        ? requestedWorkspaceId
        : null;
      return {
        notificationTargetWorkspace: target,
        workspaces: visibleWorkspaces,
        activeWorkspaceId: selectedWorkspaceId,
        workspaceAccessError: null,
      };
    }),
  removeWorkspace: (workspaceId, reason) =>
    set((state) => {
      const canonicalWorkspaces = state.canonicalWorkspaces.filter((workspace) => workspace.id !== workspaceId);
      const target = state.notificationTargetWorkspace?.workspace.id === workspaceId
        ? null
        : state.notificationTargetWorkspace;
      const visibleWorkspaces = withNotificationTarget(canonicalWorkspaces, target, state.workspaceListSessionKey);
      return {
        canonicalWorkspaces,
        notificationTargetWorkspace: target,
        workspaces: visibleWorkspaces,
        activeWorkspaceId: retainOrChooseActiveWorkspace(
          state.activeWorkspaceId,
          visibleWorkspaces,
          [canonicalWorkspaces[0]?.id ?? null, target?.workspace.id ?? null],
        ),
        workspaceAccessError: reason ?? state.workspaceAccessError,
      };
    }),
  clear: () => set({
    workspaces: [],
    canonicalWorkspaces: [],
    workspaceListSessionKey: null,
    notificationTargetWorkspace: null,
    activeWorkspaceId: null,
    workspaceAccessError: null,
  }),
}));
