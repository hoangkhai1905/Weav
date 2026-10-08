import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export const WORKFLOW_PAGE_SIZE = 20;

/** Workflows tab: pages of 20. The endpoint has no hasNext, so the mapper derives it from totalElements. */
export function useInfiniteWorkflows() {
  const workspaceId = useActiveWorkspaceId();
  return useInfiniteQuery({
    queryKey: ['workflows', workspaceId, 'infinite'],
    queryFn: ({ pageParam }) =>
      workflowRepository.getWorkflows(workspaceId ?? '', { page: pageParam, size: WORKFLOW_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled: !!workspaceId,
    staleTime: 5000,
  });
}

export function usePublishWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowRepository.publishWorkflow(getActiveWorkspaceId(), id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowRepository.deleteWorkflow(getActiveWorkspaceId(), id),
    onSuccess: (_void, id) => {
      queryClient.removeQueries({ queryKey: ['workflow', getActiveWorkspaceId(), id] });
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      void queryClient.invalidateQueries({ queryKey: ['executions'] });
    },
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
