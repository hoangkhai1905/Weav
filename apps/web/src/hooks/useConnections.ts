import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  connectionApi,
  type CreateGoogleConnectionRequest,
} from "../api/connection.api";
import { getStoredAuthToken } from "../api/ocr.api";
import { useAuthStore } from "../store/useAuthStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export const connectionKeys = {
  list: (userId: string, workspaceId: string) =>
    ["connections", userId, workspaceId, "list"] as const,
  detail: (userId: string, workspaceId: string, connectionId: string) =>
    ["connections", userId, workspaceId, "detail", connectionId] as const,
  user: (userId: string) => ["connections", userId] as const,
};

function useConnectionSessionCleanup() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(userId);

  useEffect(() => {
    const previous = previousUserId.current;
    if (previous && previous !== userId) {
      void queryClient.removeQueries({
        queryKey: connectionKeys.user(previous),
      });
    }
    if (!userId) {
      void queryClient.removeQueries({ queryKey: ["connections"] });
    }
    previousUserId.current = userId;
  }, [queryClient, userId]);
}

export function useConnections() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  useConnectionSessionCleanup();

  const query = useQuery({
    queryKey: connectionKeys.list(userId ?? "anonymous", workspaceId ?? "none"),
    enabled: Boolean(
      authenticated && userId && workspaceId && getStoredAuthToken(),
    ),
    queryFn: ({ signal }) => connectionApi.list(workspaceId!, signal),
    gcTime: 0,
  });

  return { ...query, userId, workspaceId };
}

export function useConnection(connectionId: string | null) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  useConnectionSessionCleanup();

  return useQuery({
    queryKey: connectionKeys.detail(
      userId ?? "anonymous",
      workspaceId ?? "none",
      connectionId ?? "none",
    ),
    enabled: Boolean(
      authenticated &&
      userId &&
      workspaceId &&
      connectionId &&
      getStoredAuthToken(),
    ),
    queryFn: () => connectionApi.get(workspaceId!, connectionId!),
    gcTime: 0,
  });
}

interface WorkspaceMutationVariables {
  workspaceId: string;
}

interface ItemMutationVariables extends WorkspaceMutationVariables {
  connectionId: string;
}

export function useCreateConnection() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      input,
    }: WorkspaceMutationVariables & { input: CreateGoogleConnectionRequest }) =>
      connectionApi.create(workspaceId, input),
    onSuccess: async (_connection, { workspaceId }) => {
      if (!userId) return;
      await queryClient.invalidateQueries({
        queryKey: connectionKeys.list(userId, workspaceId),
        exact: true,
      });
    },
  });
}

export function useRenameConnection() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      connectionId,
      name,
    }: ItemMutationVariables & { name: string }) =>
      connectionApi.rename(workspaceId, connectionId, name),
    onSuccess: async (_connection, { workspaceId, connectionId }) => {
      if (!userId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: connectionKeys.list(userId, workspaceId),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: connectionKeys.detail(userId, workspaceId, connectionId),
          exact: true,
        }),
      ]);
    },
  });
}

export function useTestConnection() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, connectionId }: ItemMutationVariables) =>
      connectionApi.test(workspaceId, connectionId),
    onSettled: async (_result, _error, { workspaceId, connectionId }) => {
      if (!userId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: connectionKeys.list(userId, workspaceId),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: connectionKeys.detail(userId, workspaceId, connectionId),
          exact: true,
        }),
      ]);
    },
  });
}

export function useDisableConnection() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, connectionId }: ItemMutationVariables) =>
      connectionApi.disable(workspaceId, connectionId),
    onSuccess: async (_connection, { workspaceId, connectionId }) => {
      if (!userId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: connectionKeys.list(userId, workspaceId),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: connectionKeys.detail(userId, workspaceId, connectionId),
          exact: true,
        }),
      ]);
    },
  });
}

export function useRemoveConnection() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, connectionId }: ItemMutationVariables) =>
      connectionApi.remove(workspaceId, connectionId),
    onSuccess: async (_result, { workspaceId, connectionId }) => {
      if (!userId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: connectionKeys.list(userId, workspaceId),
          exact: true,
        }),
        queryClient.removeQueries({
          queryKey: connectionKeys.detail(userId, workspaceId, connectionId),
          exact: true,
        }),
      ]);
    },
  });
}

export function useStartGoogleOAuth() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, connectionId }: ItemMutationVariables) =>
      connectionApi.startGoogleOAuth(workspaceId, connectionId),
    onSuccess: async (_result, { workspaceId, connectionId }) => {
      if (!userId) return;
      await queryClient.invalidateQueries({
        queryKey: connectionKeys.detail(userId, workspaceId, connectionId),
        exact: true,
      });
    },
  });
}
