import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { executionRepository } from '../../../infrastructure/repository-factory';
import { useActiveWorkspaceId } from '../../workspace/active-workspace';

export function useExecutions() {
  const workspaceId = useActiveWorkspaceId();
  // Tab screens stay mounted after the first visit, so an unconditional interval kept polling from
  // hidden tabs and, with ~21 requests per refresh, used up the gateway's 120 requests/min per IP.
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['executions', workspaceId],
    queryFn: () => executionRepository.listRecentWorkspaceExecutions(workspaceId ?? ''),
    enabled: !!workspaceId,
    // Each refresh fans out to up to 21 requests (client-side aggregation), so poll gently.
    refetchInterval: focused ? 30_000 : false,
  });
}
