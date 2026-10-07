import { useQuery } from '@tanstack/react-query';
import { executionRepository } from '../../../infrastructure/repository-factory';
import { ACTIVE_EXECUTION_STATUSES } from '../../../domain/execution/execution.types';
import { useActiveWorkspaceId } from '../../workspace/active-workspace';

/** An execution is only readable through its workflow, hence both ids. */
export function useExecutionDetail(workflowId: string, executionId: string) {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['execution', workspaceId, workflowId, executionId],
    queryFn: () =>
      executionRepository.getExecution(workspaceId ?? '', workflowId, executionId, { logSize: 50 }),
    enabled: !!workspaceId && !!workflowId && !!executionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_EXECUTION_STATUSES.includes(status) ? 2000 : false;
    },
  });
}
