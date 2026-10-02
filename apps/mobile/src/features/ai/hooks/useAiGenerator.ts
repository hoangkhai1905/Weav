import { useMutation } from '@tanstack/react-query';
import { aiRepository } from '../../../infrastructure/repository-factory';

export function useAiGenerator() {
  return useMutation({
    mutationFn: (prompt: string) => aiRepository.generateWorkflow(prompt),
  });
}
