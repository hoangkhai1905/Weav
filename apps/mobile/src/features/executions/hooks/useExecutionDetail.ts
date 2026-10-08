import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { executionRepository } from '../../../infrastructure/repository-factory';
import { ACTIVE_EXECUTION_STATUSES } from '../../../domain/execution/execution.types';
import { useActiveWorkspaceId } from '../../workspace/active-workspace';

export const EXECUTION_LOG_PAGE_SIZE = 50;

/**
 * An execution is only readable through its workflow, hence both ids. Polls every 2 s while the
 * run is QUEUED/RUNNING/WAITING and stops on a terminal state. Logs are paged by `logPage`.
 */
export function useExecutionDetail(workflowId: string, executionId: string, logPage = 0) {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['execution', workspaceId, workflowId, executionId, logPage],
    queryFn: () =>
      executionRepository.getExecution(workspaceId ?? '', workflowId, executionId, {
        logPage,
        logSize: EXECUTION_LOG_PAGE_SIZE,
      }),
    enabled: !!workspaceId && !!workflowId && !!executionId,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_EXECUTION_STATUSES.includes(status) ? 2000 : false;
    },
  });
}
