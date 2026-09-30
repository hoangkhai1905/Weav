import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authRepository } from '../../../infrastructure/repository-factory';
import { expireAuthSession } from '../auth-session.runtime';
import { useAuthStore } from '../../../stores/auth.store';
import type { AuthSessionPage } from '../../../domain/auth/auth.types';
import { isAuthSessionScopeCurrent } from '../session-management.utils';

const SESSION_PAGE_SIZE = 20;

export const authSessionKeys = {
  all: (userId: string) => ['auth-sessions', userId] as const,
  list: (userId: string, page: number, size: number) =>
    ['auth-sessions', userId, 'list', page, size] as const,
};

interface SessionScopeContext {
  userId: string | null;
  refreshToken: string | null;
}

interface RevokeSessionInput {
  sessionId: string;
  current: boolean;
}

function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'UNAUTHORIZED'
  );
}

function isCurrentScope(context: SessionScopeContext | undefined): boolean {
  if (!context?.userId || !context.refreshToken) return false;
  const auth = useAuthStore.getState();
  return isAuthSessionScopeCurrent(
    context.userId,
    context.refreshToken,
    auth.user?.id ?? null,
    auth.tokens?.refreshToken ?? null,
    auth.isAuthenticated,
  );
}

function retrySessionList(failureCount: number, error: unknown): boolean {
  return !isUnauthorized(error) && failureCount < 1;
}

export function useAuthSessions() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const hasAccessToken = useAuthStore((state) => Boolean(state.tokens?.accessToken));
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [userId]);

  const listQuery = useQuery<AuthSessionPage>({
    queryKey: userId
      ? authSessionKeys.list(userId, page, SESSION_PAGE_SIZE)
      : ['auth-sessions', 'anonymous', 'list', page, SESSION_PAGE_SIZE],
    enabled: isAuthenticated && Boolean(userId && hasAccessToken),
    queryFn: ({ signal }) =>
      authRepository.listSessions(page, SESSION_PAGE_SIZE, signal),
    gcTime: 0,
    retry: retrySessionList,
  });

  const revokeSessionMutation = useMutation<
    void,
    unknown,
    RevokeSessionInput,
    SessionScopeContext
  >({
    mutationFn: ({ sessionId }) => authRepository.revokeSession(sessionId),
    retry: false,
    onMutate: () => {
      const auth = useAuthStore.getState();
      return {
        userId: auth.user?.id ?? null,
        refreshToken: auth.tokens?.refreshToken ?? null,
      };
    },
    onSuccess: async (_data, variables, context) => {
      if (!isCurrentScope(context)) return;
      if (variables.current) {
        await expireAuthSession();
        return;
      }
      if (!context.userId) return;
      await queryClient.invalidateQueries({
        queryKey: authSessionKeys.all(context.userId),
      });
    },
  });

  const revokeAllMutation = useMutation<
    void,
    unknown,
    void,
    SessionScopeContext
  >({
    mutationFn: () => authRepository.revokeAllSessions(),
    retry: false,
    onMutate: () => {
      const auth = useAuthStore.getState();
      return {
        userId: auth.user?.id ?? null,
        refreshToken: auth.tokens?.refreshToken ?? null,
      };
    },
    onSuccess: async (_data, _variables, context) => {
      if (!isCurrentScope(context)) return;
      await expireAuthSession();
    },
  });

  useEffect(() => {
    revokeSessionMutation.reset();
    revokeAllMutation.reset();
    // Mutation state belongs to the previous account and must not render after a switch.
    // The mutation objects are intentionally not dependencies: React Query exposes a stable reset operation.
  }, [userId]);

  const data = listQuery.data;
  return {
    ...listQuery,
    page,
    setPage,
    pageSize: SESSION_PAGE_SIZE,
    hasPreviousPage: Boolean(data && data.page > 0),
    hasNextPage: Boolean(data && data.page + 1 < data.totalPages),
    revokeSessionMutation,
    revokeAllMutation,
  };
}
