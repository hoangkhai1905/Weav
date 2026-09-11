import { useQuery } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';

export function useWorkflowDetail(id: string) {
  return useQuery({
    queryKey: ['workflow', id],
    queryFn: () => workflowRepository.getWorkflow(id),
    enabled: !!id,
  });
}
