import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';
import { useUIStore } from '../../../stores/ui.store';

export function useRunWorkflow() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: Record<string, unknown> }) =>
      workflowRepository.runWorkflow(id, input),
    onSuccess: (res) => {
      showToast({
        type: 'success',
        title: 'Workflow Started ⚡',
        message: 'Execution queued and running...',
      });
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      return res;
    },
    onError: (err: any) => {
      showToast({
        type: 'error',
        title: 'Execution Failed to Trigger',
        message: err.message || 'Could not start workflow run.',
      });
    },
  });
}
