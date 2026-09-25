import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import {
  bootstrapAuthSession,
  retryBootstrapAuthSession,
} from './auth-session.runtime';

export function useAuthSessionBootstrap() {
  const started = useRef(false);
  const isHydrating = useAuthStore((state) => state.isHydrating);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void bootstrapAuthSession();
  }, []);

  return { isHydrating, retryBootstrap: retryBootstrapAuthSession };
}

function isAccountScopedQuery(query: { queryKey: readonly unknown[] }): boolean {
  return (
    query.queryKey[0] === 'workspaces' ||
    query.queryKey[0] === 'notifications' ||
    query.queryKey[0] === 'current-user' ||
    query.queryKey[0] === 'auth-sessions'
  );
}

export function useAuthSessionCacheCleanup() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const accountChanged =
      previousUserId.current !== undefined && previousUserId.current !== userId;
    const shouldClearAll = !isAuthenticated || accountChanged;

    if (shouldClearAll) {
      void queryClient.cancelQueries({ predicate: isAccountScopedQuery });
      queryClient.removeQueries({ predicate: isAccountScopedQuery });
    } else if (userId) {
      queryClient.removeQueries({
        predicate: (query) =>
          isAccountScopedQuery(query) && query.queryKey[1] !== userId,
      });
    }

    previousUserId.current = userId;
  }, [isAuthenticated, queryClient, userId]);
}
