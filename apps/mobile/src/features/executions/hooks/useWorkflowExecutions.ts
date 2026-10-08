import { useQuery } from '@tanstack/react-query';
import { executionRepository } from '../../../infrastructure/repository-factory';
import { ACTIVE_EXECUTION_STATUSES } from '../../../domain/execution/execution.types';
import { useActiveWorkspaceId } from '../../workspace/active-workspace';

/** Latest runs of ONE workflow (workflow detail screen). Polls while any run is still active. */
export function useWorkflowExecutions(workflowId: string, enabled = true) {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['executions', workspaceId, 'workflow', workflowId],
    queryFn: () =>
      executionRepository.listWorkflowExecutions(workspaceId ?? '', workflowId, { page: 0, size: 10 }),
    enabled: enabled && !!workspaceId && !!workflowId,
    refetchInterval: (query) =>
      query.state.data?.items.some((e) => ACTIVE_EXECUTION_STATUSES.includes(e.status)) ? 3000 : false,
  });
}
