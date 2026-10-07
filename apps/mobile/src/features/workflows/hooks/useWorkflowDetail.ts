import { useQuery } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';
import { useActiveWorkspaceId } from '../../workspace/active-workspace';

export function useWorkflowDetail(workflowId: string) {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['workflow', workspaceId, workflowId],
    queryFn: () => workflowRepository.getWorkflow(workspaceId ?? '', workflowId),
    enabled: !!workspaceId && !!workflowId,
  });
}
