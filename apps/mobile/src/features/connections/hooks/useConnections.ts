import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { connectionRepository } from '../../../infrastructure/repository-factory';

export function useConnections() {
  return useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionRepository.getConnections(),
  });
}

export function useTestConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connectionRepository.testConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
