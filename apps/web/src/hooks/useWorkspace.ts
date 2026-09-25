import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isWorkspaceMockMode,
  WorkspaceApiError,
  workspaceApi,
} from '../api/workspace.api';
import { getStoredAuthToken } from '../api/ocr.api';
import { useAuthStore } from '../store/useAuthStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

export const workspaceKeys = {
  list: (userId: string) => ['workspaces', userId, 'list'] as const,
  detail: (userId: string, workspaceId: string) => ['workspaces', userId, 'detail', workspaceId] as const,
  members: (userId: string, workspaceId: string) => ['workspaces', userId, 'members', workspaceId] as const,
};

function shouldRetryWorkspaceQuery(failureCount: number, error: Error) {
  return failureCount < 1 && !(error instanceof WorkspaceApiError && error.status >= 400 && error.status < 500);
}

export function useWorkspaceSessionCleanup() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousUserId.current;
    if (previous === userId) return;

    if (previous) {
      void queryClient.removeQueries({ queryKey: ['workspaces', previous] });
    }
    if (!userId) {
      useWorkspaceStore.getState().clear();
      void queryClient.removeQueries({ queryKey: ['workspaces'] });
    } else if (previous) {
      useWorkspaceStore.getState().clear();
    }
    previousUserId.current = userId;

    return () => {
      if (previousUserId.current !== userId) return;
      useWorkspaceStore.getState().clear();
      void queryClient.removeQueries({ queryKey: ['workspaces'] });
      previousUserId.current = null;
    };
  }, [queryClient, userId]);
}

function useWorkspaceListData() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);

  const sessionEnabled = Boolean(authenticated && userId && (isWorkspaceMockMode || getStoredAuthToken()));
  const workspacesQuery = useQuery({
    queryKey: workspaceKeys.list(userId ?? 'anonymous'),
    enabled: sessionEnabled,
    queryFn: ({ signal }) => workspaceApi.listWorkspaces({}, signal),
    retry: shouldRetryWorkspaceQuery,
    gcTime: 0,
  });

  useEffect(() => {
    if (workspacesQuery.isSuccess) setWorkspaces(workspacesQuery.data.items);
  }, [setWorkspaces, workspacesQuery.data, workspacesQuery.isSuccess]);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  return {
    userId,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    workspacesQuery,
    sessionEnabled,
  };
}

export function useWorkspaceListContext() {
  const workspaceList = useWorkspaceListData();
  return {
    userId: workspaceList.userId,
    workspaces: workspaceList.workspaces,
    activeWorkspace: workspaceList.activeWorkspace,
    activeWorkspaceId: workspaceList.activeWorkspaceId,
    workspacesQuery: workspaceList.workspacesQuery,
  };
}

export function useWorkspaceContext() {
  const {
    userId,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    workspacesQuery,
    sessionEnabled,
  } = useWorkspaceListData();
  const membersQuery = useQuery({
    queryKey: workspaceKeys.members(userId ?? 'anonymous', activeWorkspaceId ?? 'none'),
    enabled: Boolean(sessionEnabled && activeWorkspaceId && activeWorkspace),
    queryFn: ({ signal }) => workspaceApi.getMembers(activeWorkspaceId!, {}, signal),
    retry: shouldRetryWorkspaceQuery,
    gcTime: 0,
  });

  return {
    userId,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    workspacesQuery,
    membersQuery,
  };
}
