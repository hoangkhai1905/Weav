import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { connectionRepository } from '../../../infrastructure/repository-factory';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../auth/auth-session.scope';
import { showMilestoneToastForSession } from '../../feedback/milestone-toast';
import { notificationQueryKey } from '../../notifications/notification.query';
import { getActiveWorkspaceId, useActiveWorkspaceId } from '../../workspace/active-workspace';

export function useConnections() {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['connections', workspaceId],
    queryFn: () => connectionRepository.getConnections(workspaceId ?? ''),
    enabled: !!workspaceId,
  });
}

export function useTestConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connectionRepository.testConnection(getActiveWorkspaceId(), id),
    onMutate: () => captureAuthSessionScope(),
    onSuccess: (outcome, _id, scope) => {
      if (!scope || !isAuthSessionScopeCurrent(scope)) return;
      if (outcome === 'VERIFIED') {
        showMilestoneToastForSession(scope, 'connection.verified', () => {
          void queryClient.invalidateQueries({ queryKey: notificationQueryKey(scope.userId, scope.generation) });
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useDisableConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connectionRepository.disableConnection(getActiveWorkspaceId(), id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
