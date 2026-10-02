import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { telegramRepository } from '../../../infrastructure/repository-factory';

export function useTelegram() {
  const statusQuery = useQuery({
    queryKey: ['telegram', 'status'],
    queryFn: () => telegramRepository.getStatus(),
  });

  const linkCodeMutation = useMutation({
    mutationFn: () => telegramRepository.createLinkCode(),
  });

  const queryClient = useQueryClient();
  const unlinkMutation = useMutation({
    mutationFn: () => telegramRepository.unlink(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram'] });
    },
  });

  return {
    telegramStatus: statusQuery.data,
    isLoading: statusQuery.isLoading,
    createLinkCode: linkCodeMutation.mutateAsync,
    isGeneratingCode: linkCodeMutation.isPending,
    unlinkTelegram: unlinkMutation.mutateAsync,
    isUnlinking: unlinkMutation.isPending,
  };
}
