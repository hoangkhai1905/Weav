import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';
import { useUIStore } from '../../../stores/ui.store';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../auth/auth-session.scope';
import { showMilestoneToastForSession } from '../../feedback/milestone-toast';
import { notificationQueryKey } from '../../notifications/notification.query';

type RunWorkflowVariables = { id: string; input?: Record<string, unknown> };
type RunWorkflowScope = ReturnType<typeof captureAuthSessionScope>;
type ShowToast = ReturnType<typeof useUIStore.getState>['showToast'];

export function createRunWorkflowMutationOptions(
  queryClient: QueryClient,
  showToast: ShowToast,
): UseMutationOptions<{ executionId: string }, Error, RunWorkflowVariables, RunWorkflowScope> {
  return {
    mutationFn: ({ id, input }) => workflowRepository.runWorkflow(id, input),
    onMutate: () => captureAuthSessionScope(),
    onSuccess: (res, _variables, scope) => {
      if (!scope || !isAuthSessionScopeCurrent(scope)) return res;
      showMilestoneToastForSession(scope, 'workflow.started', () => {
        void queryClient.invalidateQueries({ queryKey: notificationQueryKey(scope.userId, scope.generation) });
      });
      void queryClient.invalidateQueries({ queryKey: ['executions'] });
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      return res;
    },
    onError: (err, _variables, scope) => {
      if (!scope || !isAuthSessionScopeCurrent(scope)) return;
      showToast({
        type: 'error',
        title: 'Execution Failed to Trigger',
        message: err.message || 'Could not start workflow run.',
      });
    },
  };
}

export function useRunWorkflow() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  return useMutation(createRunWorkflowMutationOptions(queryClient, showToast));
}
