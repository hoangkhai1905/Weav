import { useQuery } from '@tanstack/react-query';
import { executionRepository } from '../../../infrastructure/repository-factory';
import { useActiveWorkspaceId } from '../../workspace/active-workspace';

export function useExecutions() {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['executions', workspaceId],
    queryFn: () => executionRepository.listRecentWorkspaceExecutions(workspaceId ?? ''),
    enabled: !!workspaceId,
    // Each refresh fans out to up to 21 requests (client-side aggregation), so poll gently.
    refetchInterval: 15000,
  });
}
