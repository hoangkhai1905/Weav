import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../auth/auth-session.scope';
import { showMilestoneToastForSession } from '../../feedback/milestone-toast';
import { notificationQueryKey } from '../../notifications/notification.query';

export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => workflowRepository.getWorkflows(),
    staleTime: 5000,
  });
}

export function usePauseWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowRepository.pauseWorkflow(id),
    onMutate: () => captureAuthSessionScope(),
    onSuccess: (_workflow, _id, scope) => {
      if (!scope || !isAuthSessionScopeCurrent(scope)) return;
      showMilestoneToastForSession(scope, 'workflow.paused', () => {
        void queryClient.invalidateQueries({ queryKey: notificationQueryKey(scope.userId, scope.generation) });
      });
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

export function useResumeWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowRepository.resumeWorkflow(id),
    onMutate: () => captureAuthSessionScope(),
    onSuccess: (_workflow, _id, scope) => {
      if (!scope || !isAuthSessionScopeCurrent(scope)) return;
      showMilestoneToastForSession(scope, 'workflow.resumed', () => {
        void queryClient.invalidateQueries({ queryKey: notificationQueryKey(scope.userId, scope.generation) });
      });
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}
