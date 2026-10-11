import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { workspaceRepository } from '../../../infrastructure/repository-factory';
import { useAuthStore } from '../../../stores/auth.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';
import { loadWorkspaces, workspaceKeys } from './useWorkspace';
import { useSwitchWorkspace } from './useSwitchWorkspace';

// Keys start with 'workspaces' so sign-out / account switch drops them (see isAccountScopedQuery).
export const invitationKeys = {
  owner: (userId: string, workspaceId: string) => ['workspaces', userId, 'invitations', workspaceId] as const,
  mine: (userId: string) => ['workspaces', userId, 'my-invitations'] as const,
};

/** The gateway allows 120 requests/min per IP, so the Home banner only checks once a minute. */
export const MY_INVITATIONS_POLL_MS = 60_000;

const useUserId = () => useAuthStore((s) => s.user?.id ?? null);

/** Pending invitations of the active workspace; only ask when the user is its owner. */
export function useOwnerInvitations(enabled: boolean) {
  const userId = useUserId();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useQuery({
    queryKey: userId && workspaceId ? invitationKeys.owner(userId, workspaceId) : ['workspaces', 'anonymous', 'invitations', 'none'],
    queryFn: ({ signal }) => workspaceRepository.listInvitations(workspaceId as string, signal),
    enabled: enabled && !!userId && !!workspaceId,
    staleTime: 10_000,
  });
}

/** Owner actions; each one reloads the pending list when it settles, even after a failure. */
export function useInvitationActions() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  const refresh = (workspaceId: string) => {
    if (userId) void queryClient.invalidateQueries({ queryKey: invitationKeys.owner(userId, workspaceId) });
  };
  const invite = useMutation({
    mutationFn: ({ workspaceId, email }: { workspaceId: string; email: string }) =>
      workspaceRepository.createInvitation(workspaceId, { email }),
    retry: false,
    onSettled: (_data, _error, { workspaceId }) => refresh(workspaceId),
  });
  const resend = useMutation({
    mutationFn: ({ workspaceId, invitationId }: { workspaceId: string; invitationId: string }) =>
      workspaceRepository.resendInvitation(workspaceId, invitationId),
    retry: false,
    onSettled: (_data, _error, { workspaceId }) => refresh(workspaceId),
  });
  const revoke = useMutation({
    mutationFn: ({ workspaceId, invitationId }: { workspaceId: string; invitationId: string }) =>
      workspaceRepository.revokeInvitation(workspaceId, invitationId),
    retry: false,
    onSettled: (_data, _error, { workspaceId }) => refresh(workspaceId),
  });
  return { invite, resend, revoke };
}

/** The signed-in user's own invitations. `poll` is for the Home banner: once a minute, only while focused. */
export function useMyInvitations(options: { poll?: boolean } = {}) {
  const userId = useUserId();
  // Tab screens stay mounted, so polling must stop when the screen is not in front.
  const focused = useIsFocused();
  return useQuery({
    queryKey: userId ? invitationKeys.mine(userId) : ['workspaces', 'anonymous', 'my-invitations'],
    queryFn: ({ signal }) => workspaceRepository.listMyInvitations(signal),
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: options.poll && focused ? MY_INVITATIONS_POLL_MS : false,
  });
}

/**
 * Accept answers `{workspaceId}`. The workspace list is then reloaded and the new workspace becomes
 * the active one; a failure of that second part is not reported as a failed accept (the list
 * refetch below recovers it).
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  const switchWorkspace = useSwitchWorkspace();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { workspaceId } = await workspaceRepository.acceptInvitation(invitationId);
      if (userId) {
        try {
          const page = await queryClient.fetchQuery({
            queryKey: workspaceKeys.list(userId),
            queryFn: ({ signal }) => loadWorkspaces(userId, signal),
            staleTime: 0,
          });
          if (useAuthStore.getState().user?.id === userId) {
            useWorkspaceStore.getState().setWorkspaces(page.items);
            switchWorkspace(workspaceId);
          }
        } catch {
          void queryClient.invalidateQueries({ queryKey: workspaceKeys.list(userId) });
        }
      }
      return workspaceId;
    },
    retry: false,
    onSettled: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: invitationKeys.mine(userId) });
    },
  });
}

export function useDeclineInvitation() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: (invitationId: string) => workspaceRepository.declineInvitation(invitationId),
    retry: false,
    onSettled: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: invitationKeys.mine(userId) });
    },
  });
}

/** E-mail check for the invitee: send a code, then confirm it; the invitation list reloads on success. */
export function useEmailVerification() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  const sendCode = useMutation({
    mutationFn: () => workspaceRepository.requestEmailVerification(),
    retry: false,
  });
  const verify = useMutation({
    mutationFn: ({ challengeId, code }: { challengeId: string; code: string }) =>
      workspaceRepository.verifyEmail(challengeId, code),
    retry: false,
    onSuccess: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: invitationKeys.mine(userId) });
    },
  });
  return { sendCode, verify };
}
