import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../auth/auth-session.scope';
import { showMilestoneToastForSession } from '../../feedback/milestone-toast';
import { notificationQueryKey } from '../../notifications/notification.query';
import { getActiveWorkspaceId, useActiveWorkspaceId } from '../../workspace/active-workspace';

/** First page (up to 100) of the workspace's workflows. TODO(ui step): infinite scroll. */
export function useWorkflows() {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['workflows', workspaceId],
    queryFn: () => workflowRepository.getWorkflows(workspaceId ?? '', { page: 0, size: 100 }),
    select: (page) => page.items,
    enabled: !!workspaceId,
    staleTime: 5000,
  });
}

function useWorkflowStateMutation(
  action: 'pauseWorkflow' | 'resumeWorkflow',
  milestone: 'workflow.paused' | 'workflow.resumed',
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowRepository[action](getActiveWorkspaceId(), id),
    onMutate: () => captureAuthSessionScope(),
    onSuccess: (_workflow, id, scope) => {
      if (!scope || !isAuthSessionScopeCurrent(scope)) return;
      showMilestoneToastForSession(scope, milestone, () => {
        void queryClient.invalidateQueries({ queryKey: notificationQueryKey(scope.userId, scope.generation) });
      });
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      // pause/resume return triggers: [], so the detail is refetched rather than patched.
      void queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
  });
}

export function usePauseWorkflow() {
  return useWorkflowStateMutation('pauseWorkflow', 'workflow.paused');
}

export function useResumeWorkflow() {
  return useWorkflowStateMutation('resumeWorkflow', 'workflow.resumed');
}

/** workflowId -> name, from the loaded workflows (executions only carry workflowId). */
export function useWorkflowNames(): Map<string, string> {
  const { data } = useWorkflows();
  return new Map((data ?? []).map((workflow) => [workflow.workflowId, workflow.name]));
}
