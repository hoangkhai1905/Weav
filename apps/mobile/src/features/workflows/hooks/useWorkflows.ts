import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';

export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => workflowRepository.getWorkflows(),
    staleTime: 5000,
  });
}

export function usePauseWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowRepository.pauseWorkflow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

export function useResumeWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowRepository.resumeWorkflow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}
