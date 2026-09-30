import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { connectionRepository } from '../../../infrastructure/repository-factory';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../auth/auth-session.scope';
import { showMilestoneToastForSession } from '../../feedback/milestone-toast';
import { notificationQueryKey } from '../../notifications/notification.query';

export function useConnections() {
  return useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionRepository.getConnections(),
  });
}

export function useTestConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connectionRepository.testConnection(id),
    onMutate: () => captureAuthSessionScope(),
    onSuccess: (result, _id, scope) => {
      if (!scope || !isAuthSessionScopeCurrent(scope)) return;
      if (result.success) {
        showMilestoneToastForSession(scope, 'connection.verified', () => {
          void queryClient.invalidateQueries({ queryKey: notificationQueryKey(scope.userId, scope.generation) });
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
