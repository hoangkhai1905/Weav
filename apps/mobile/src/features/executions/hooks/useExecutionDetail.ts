import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { executionRepository } from '../../../infrastructure/repository-factory';

export function useExecutionDetail(id: string) {
  return useQuery({
    queryKey: ['execution', id],
    queryFn: () => executionRepository.getExecution(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'QUEUED' || status === 'RUNNING' ? 1500 : false;
    },
  });
}

export function useRetryExecution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => executionRepository.retryExecution(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['execution', res.id] });
    },
  });
}
