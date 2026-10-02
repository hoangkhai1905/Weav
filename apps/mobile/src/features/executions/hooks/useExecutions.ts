import { useQuery } from '@tanstack/react-query';
import { executionRepository } from '../../../infrastructure/repository-factory';

export function useExecutions() {
  return useQuery({
    queryKey: ['executions'],
    queryFn: () => executionRepository.getExecutions(),
    refetchInterval: 3000, // Automatic polling for realtime execution simulation
  });
}
