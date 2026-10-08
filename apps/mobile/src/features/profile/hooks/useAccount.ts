import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountRepository, authRepository } from '../../../infrastructure/repository-factory';
import { useAuthStore } from '../../../stores/auth.store';
import { expireAuthSession } from '../../auth/auth-session.runtime';
import { authSessionKeys } from '../../auth/hooks/useAuthSessions';
import { profileKeys } from './useProfile';

export const accountKeys = {
  avatar: (userId: string) => ['avatar', userId] as const,
  oauth: (userId: string) => ['oauth-accounts', userId] as const,
};

/** Signed avatar URL (short-lived, so it is refetched rather than stored). Off when the user has no avatar. */
export function useAvatarUrl(hasAvatar: boolean) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery({
    queryKey: accountKeys.avatar(userId ?? ''),
    enabled: hasAvatar && !!userId,
    staleTime: 2 * 60_000,
    retry: false,
    queryFn: () => accountRepository.getAvatarUrl(),
  });
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation({
    mutationFn: () => accountRepository.deleteAvatar(),
    onSuccess: () => {
      if (!userId) return;
      queryClient.removeQueries({ queryKey: accountKeys.avatar(userId) });
      void queryClient.invalidateQueries({ queryKey: profileKeys.current(userId) });
    },
  });
}

/** Linked sign-in providers (read-only; unlinking stays on the web, it needs the browser CSRF cookie). */
export function useOAuthAccounts() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery({
    queryKey: accountKeys.oauth(userId ?? ''),
    enabled: !!userId,
    retry: false,
    queryFn: () => accountRepository.listOAuthAccounts(),
  });
}

const OTHERS_PAGE_SIZE = 50;

/**
 * "Sign out the other devices". The backend only offers "revoke one" and "revoke ALL (this one too)",
 * so this lists every session and revokes the non-current ones. Resolves to how many it revoked.
 */
export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const ids: string[] = [];
      for (let page = 0; page < 20; page += 1) {
        const result = await authRepository.listSessions(page, OTHERS_PAGE_SIZE);
        for (const s of result.items) if (!s.current) ids.push(s.id);
        if (page + 1 >= result.totalPages) break;
      }
      const outcomes = await Promise.allSettled(ids.map((id) => authRepository.revokeSession(id)));
      const failed = outcomes.filter((o) => o.status === 'rejected');
      if (failed.length > 0) {
        const reason = (failed[0] as PromiseRejectedResult).reason;
        // An expired session logs the user out through the shared handler.
        if ((reason as { code?: string } | null)?.code === 'UNAUTHORIZED') void expireAuthSession();
        throw reason;
      }
      return ids.length;
    },
    retry: false,
    onSettled: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: authSessionKeys.all(userId) });
    },
  });
}
