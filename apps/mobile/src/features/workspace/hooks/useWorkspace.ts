import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaceRepository } from '../../../infrastructure/repository-factory';
import type {
  AddWorkspaceMemberInput,
  PageResult,
  CreateWorkspaceInput,
  RenameWorkspaceInput,
  Workspace,
  WorkspaceMember,
  UpdateWorkspaceMemberPermissionsInput,
} from '../../../domain/workspace/workspace.types';
import { useAuthStore } from '../../../stores/auth.store';
import {
  selectActiveWorkspace,
  useWorkspaceStore,
} from '../../../stores/workspace.store';
import { loadAllPages } from '../workspace.pagination';
import {
  isWorkspaceMemberMutationScopeCurrent,
  isWorkspaceMutationScopeCurrent,
  mergeWorkspaceList,
  mergeWorkspacePage,
} from '../workspace.mutations';

export const workspaceKeys = {
  list: (userId: string) => ['workspaces', userId, 'list'] as const,
  detail: (userId: string, workspaceId: string) =>
    ['workspaces', userId, 'detail', workspaceId] as const,
  members: (userId: string, workspaceId: string) =>
    ['workspaces', userId, 'members', workspaceId] as const,
};

function isCurrentWorkspaceScope(userId: string, workspaceId?: string): boolean {
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || auth.user?.id !== userId) return false;
  return workspaceId === undefined
    ? true
    : useWorkspaceStore.getState().activeWorkspaceId === workspaceId;
}

function isCurrentMemberMutationScope(context: MemberMutationContext): boolean {
  return (
    context.userId !== null &&
    isWorkspaceMemberMutationScopeCurrent(
      context.userId,
      context.workspaceId,
      useAuthStore.getState().user?.id ?? null,
      useWorkspaceStore.getState().activeWorkspaceId,
      useAuthStore.getState().isAuthenticated,
    )
  );
}

function isSelectionGone(error: unknown): boolean {
  const candidate = error as { status?: number; code?: string } | null;
  return (
    candidate?.status === 403 ||
    candidate?.status === 404 ||
    candidate?.code === 'FORBIDDEN' ||
    candidate?.code === 'NOT_FOUND'
  );
}

function shouldRetryWorkspace(failureCount: number, error: unknown): boolean {
  const candidate = error as { code?: string } | null;
  return candidate?.code !== 'UNAUTHORIZED' && !isSelectionGone(error) && failureCount < 1;
}

function errorMessage(error: unknown, fallback: string): string {
  const candidate = error as { message?: string } | null;
  return candidate?.message || fallback;
}

interface WorkspaceMutationContext {
  userId: string | null;
  workspaceId?: string;
}

interface RenameWorkspaceMutation {
  workspaceId: string;
  input: RenameWorkspaceInput;
}

interface AddMemberMutationContext {
  userId: string | null;
  workspaceId: string;
}

interface UpdateMemberPermissionsMutation {
  workspaceId: string;
  userId: string;
  input: UpdateWorkspaceMemberPermissionsInput;
}

interface MemberTargetMutation {
  workspaceId: string;
  userId: string;
}

interface MemberMutationContext {
  userId: string | null;
  workspaceId: string;
  userIdTarget?: string;
}

async function loadWorkspaces(
  userId: string,
  signal: AbortSignal,
): Promise<PageResult<Workspace>> {
  return loadAllPages(
    (page) => workspaceRepository.listWorkspaces({ page, size: 100 }, signal),
    'Workspace list',
    () => isCurrentWorkspaceScope(userId),
  );
}

async function loadMembers(
  userId: string,
  workspaceId: string,
  signal: AbortSignal,
): Promise<PageResult<WorkspaceMember>> {
  return loadAllPages(
    (page) => workspaceRepository.getMembers(workspaceId, { page, size: 100 }, signal),
    'Workspace members',
    () => isCurrentWorkspaceScope(userId, workspaceId),
  );
}

export function useWorkspace() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const workspaceAccessError = useWorkspaceStore(
    (state) => state.workspaceAccessError,
  );
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const markWorkspaceUnavailable = useWorkspaceStore(
    (state) => state.markWorkspaceUnavailable,
  );

  const listQuery = useQuery({
    queryKey: userId ? workspaceKeys.list(userId) : ['workspaces', 'anonymous', 'list'],
    enabled: isAuthenticated && Boolean(userId),
    queryFn: ({ signal }) => loadWorkspaces(userId as string, signal),
    retry: shouldRetryWorkspace,
  });

  useEffect(() => {
    if (
      listQuery.data &&
      userId &&
      isCurrentWorkspaceScope(userId)
    ) {
      setWorkspaces(listQuery.data.items);
    }
  }, [listQuery.data, setWorkspaces, userId]);

  const selectedWorkspaceId = activeWorkspaceId;
  const detailQuery = useQuery({
    queryKey:
      userId && selectedWorkspaceId
        ? workspaceKeys.detail(userId, selectedWorkspaceId)
        : ['workspaces', 'anonymous', 'detail', 'none'],
    enabled: isAuthenticated && Boolean(userId && selectedWorkspaceId),
    queryFn: ({ signal }) =>
      workspaceRepository.getWorkspace(selectedWorkspaceId as string, signal),
    retry: shouldRetryWorkspace,
  });

  const membersQuery = useQuery({
    queryKey:
      userId && selectedWorkspaceId
        ? workspaceKeys.members(userId, selectedWorkspaceId)
        : ['workspaces', 'anonymous', 'members', 'none'],
    enabled: isAuthenticated && Boolean(userId && selectedWorkspaceId),
    queryFn: ({ signal }) =>
      loadMembers(userId as string, selectedWorkspaceId as string, signal),
    retry: shouldRetryWorkspace,
  });

  const createWorkspaceMutation = useMutation<
    Workspace,
    unknown,
    CreateWorkspaceInput,
    WorkspaceMutationContext
  >({
    mutationFn: async (input) => {
      const auth = useAuthStore.getState();
      if (!auth.isAuthenticated || !auth.user?.id) {
        throw { code: 'UNAUTHORIZED', message: 'Please sign in again.' };
      }
      return workspaceRepository.createWorkspace(input);
    },
    retry: false,
    onMutate: () => ({ userId: useAuthStore.getState().user?.id ?? null }),
    onSuccess: (created, _input, context) => {
      if (
        !context?.userId ||
        !isWorkspaceMutationScopeCurrent(
          context.userId,
          useAuthStore.getState().user?.id ?? null,
          useAuthStore.getState().isAuthenticated,
        )
      ) {
        return;
      }

      const listKey = workspaceKeys.list(context.userId);
      queryClient.setQueryData<PageResult<Workspace>>(listKey, (page) =>
        mergeWorkspacePage(page, created),
      );
      queryClient.setQueryData(
        workspaceKeys.detail(context.userId, created.id),
        created,
      );
      useWorkspaceStore
        .getState()
        .setWorkspaces(mergeWorkspaceList(useWorkspaceStore.getState().workspaces, created));
      useWorkspaceStore.getState().selectWorkspace(created.id);
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  const renameWorkspaceMutation = useMutation<
    Workspace,
    unknown,
    RenameWorkspaceMutation,
    WorkspaceMutationContext
  >({
    mutationFn: ({ workspaceId, input }) =>
      workspaceRepository.renameWorkspace(workspaceId, input),
    retry: false,
    onMutate: ({ workspaceId }) => ({
      userId: useAuthStore.getState().user?.id ?? null,
      workspaceId,
    }),
    onSuccess: (renamed, variables, context) => {
      if (
        !context?.userId ||
        !isWorkspaceMutationScopeCurrent(
          context.userId,
          useAuthStore.getState().user?.id ?? null,
          useAuthStore.getState().isAuthenticated,
        )
      ) {
        return;
      }

      const workspaceId = context.workspaceId ?? variables.workspaceId;
      const listKey = workspaceKeys.list(context.userId);
      const detailKey = workspaceKeys.detail(context.userId, workspaceId);
      queryClient.setQueryData<PageResult<Workspace>>(listKey, (page) =>
        mergeWorkspacePage(page, renamed),
      );
      queryClient.setQueryData(detailKey, renamed);
      useWorkspaceStore
        .getState()
        .setWorkspaces(mergeWorkspaceList(useWorkspaceStore.getState().workspaces, renamed));
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const addMemberMutation = useMutation<
    WorkspaceMember,
    unknown,
    AddWorkspaceMemberInput,
    AddMemberMutationContext
  >({
    mutationFn: async (input) => {
      const auth = useAuthStore.getState();
      const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
      if (!auth.isAuthenticated || !auth.user?.id || !workspaceId) {
        throw { code: 'INVALID_WORKSPACE', message: 'Select a workspace before adding a member.' };
      }
      return workspaceRepository.addMember(workspaceId, input);
    },
    retry: false,
    onMutate: () => ({
      userId: useAuthStore.getState().user?.id ?? null,
      workspaceId: useWorkspaceStore.getState().activeWorkspaceId ?? '',
    }),
    onSuccess: (_member, _input, context) => {
      if (!context || !isCurrentMemberMutationScope(context)) return;
      void invalidateWorkspaceMemberScope(queryClient, context.userId as string, context.workspaceId);
    },
  });

  const updateMemberPermissionsMutation = useMutation<
    WorkspaceMember,
    unknown,
    UpdateMemberPermissionsMutation,
    MemberMutationContext
  >({
    mutationFn: ({ workspaceId, userId: targetUserId, input }) =>
      workspaceRepository.updateMemberPermissions(workspaceId, targetUserId, input),
    retry: false,
    onMutate: ({ workspaceId, userId: targetUserId }) => ({
      userId: useAuthStore.getState().user?.id ?? null,
      workspaceId,
      userIdTarget: targetUserId,
    }),
    onSuccess: (_member, _variables, context) => {
      if (!context || !isCurrentMemberMutationScope(context)) return;
      void invalidateWorkspaceMemberScope(queryClient, context.userId as string, context.workspaceId);
    },
  });

  const removeMemberMutation = useMutation<
    void,
    unknown,
    MemberTargetMutation,
    MemberMutationContext
  >({
    mutationFn: ({ workspaceId, userId: targetUserId }) =>
      workspaceRepository.removeMember(workspaceId, targetUserId),
    retry: false,
    onMutate: ({ workspaceId, userId: targetUserId }) => ({
      userId: useAuthStore.getState().user?.id ?? null,
      workspaceId,
      userIdTarget: targetUserId,
    }),
    onSuccess: (_result, variables, context) => {
      if (!context || !isCurrentMemberMutationScope(context)) return;
      if (context.userIdTarget === context.userId) {
        removeWorkspaceAfterMembershipLoss(queryClient, context.userId as string, context.workspaceId);
        return;
      }
      void invalidateWorkspaceMemberScope(queryClient, context.userId as string, context.workspaceId);
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(context.userId as string, variables.workspaceId) });
    },
  });

  const leaveWorkspaceMutation = useMutation<
    void,
    unknown,
    string,
    MemberMutationContext
  >({
    mutationFn: (workspaceId) => workspaceRepository.leaveWorkspace(workspaceId),
    retry: false,
    onMutate: (workspaceId) => ({
      userId: useAuthStore.getState().user?.id ?? null,
      workspaceId,
    }),
    onSuccess: (_result, _workspaceId, context) => {
      if (!context || !isCurrentMemberMutationScope(context)) return;
      removeWorkspaceAfterMembershipLoss(queryClient, context.userId as string, context.workspaceId);
    },
    onError: (error, _workspaceId, context) => {
      if (!context || !isCurrentMemberMutationScope(context)) return;
      const candidate = error as { status?: number; code?: string } | null;
      if (candidate?.status === 404 || candidate?.code === 'NOT_FOUND') {
        removeWorkspaceAfterMembershipLoss(queryClient, context.userId as string, context.workspaceId);
      }
    },
  });

  useEffect(() => {
    createWorkspaceMutation.reset();
    renameWorkspaceMutation.reset();
    addMemberMutation.reset();
    updateMemberPermissionsMutation.reset();
    removeMemberMutation.reset();
    leaveWorkspaceMutation.reset();
  }, [
    addMemberMutation.reset,
    createWorkspaceMutation.reset,
    isAuthenticated,
    leaveWorkspaceMutation.reset,
    removeMemberMutation.reset,
    renameWorkspaceMutation.reset,
    updateMemberPermissionsMutation.reset,
    userId,
  ]);

  useEffect(() => {
    const error = detailQuery.error ?? membersQuery.error;
    if (!error || !selectedWorkspaceId || !userId || !isSelectionGone(error)) {
      return;
    }
    if (!isCurrentWorkspaceScope(userId, selectedWorkspaceId)) return;

    markWorkspaceUnavailable(
      selectedWorkspaceId,
      errorMessage(error, 'This workspace is no longer available.'),
    );
    queryClient.removeQueries({
      queryKey: workspaceKeys.detail(userId, selectedWorkspaceId),
    });
    queryClient.removeQueries({
      queryKey: workspaceKeys.members(userId, selectedWorkspaceId),
    });
    queryClient.invalidateQueries({ queryKey: workspaceKeys.list(userId) });
  }, [
    detailQuery.error,
    markWorkspaceUnavailable,
    membersQuery.error,
    queryClient,
    selectedWorkspaceId,
    userId,
  ]);

  const retryWorkspace = async () => {
    await listQuery.refetch();
  };

  const retryMembers = async () => {
    await membersQuery.refetch();
  };

  const retryDetail = async () => {
    await detailQuery.refetch();
  };

  return {
    workspaces,
    activeWorkspace: detailQuery.data ?? activeWorkspace,
    activeWorkspaceId,
    members: membersQuery.data?.items ?? [],
    isLoadingWorkspace: listQuery.isPending || listQuery.isFetching,
    isLoadingDetail: detailQuery.isPending || detailQuery.isFetching,
    isLoadingMembers: membersQuery.isPending || membersQuery.isFetching,
    workspaceError: listQuery.error,
    detailError: detailQuery.error,
    membersError: membersQuery.error,
    workspaceAccessError,
    selectWorkspace,
    retryWorkspace,
    retryDetail,
    retryMembers,
    createWorkspaceMutation,
    renameWorkspaceMutation,
    addMemberMutation,
    updateMemberPermissionsMutation,
    removeMemberMutation,
    leaveWorkspaceMutation,
  };
}

function invalidateWorkspaceMemberScope(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  workspaceId: string,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workspaceKeys.members(userId, workspaceId) }),
    queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(userId, workspaceId) }),
    queryClient.invalidateQueries({ queryKey: workspaceKeys.list(userId) }),
  ]).then(() => undefined);
}

function removeWorkspaceAfterMembershipLoss(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  workspaceId: string,
): void {
  useWorkspaceStore.getState().removeWorkspace(workspaceId);
  queryClient.removeQueries({ queryKey: workspaceKeys.detail(userId, workspaceId) });
  queryClient.removeQueries({ queryKey: workspaceKeys.members(userId, workspaceId) });
  void queryClient.invalidateQueries({ queryKey: workspaceKeys.list(userId) });
}

export function useWorkspaceSessionCleanup() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const clearWorkspaceSession = useWorkspaceStore(
    (state) => state.clearWorkspaceSession,
  );

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      clearWorkspaceSession();
      queryClient.removeQueries({ queryKey: ['workspaces'] });
      return;
    }

    queryClient.removeQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return key[0] === 'workspaces' && key[1] !== userId;
      },
    });
  }, [clearWorkspaceSession, isAuthenticated, queryClient, userId]);
}
