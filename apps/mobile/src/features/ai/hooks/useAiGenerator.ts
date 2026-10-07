import { useMutation } from '@tanstack/react-query';
import { aiRepository } from '../../../infrastructure/repository-factory';
import type { AiGenerateRequest } from '../../../domain/ai/ai.types';
import { getActiveWorkspaceId } from '../../workspace/active-workspace';

export function useAiGenerator() {
  return useMutation({
    mutationFn: (request: AiGenerateRequest) =>
      aiRepository.generateWorkflow(getActiveWorkspaceId(), request),
  });
}
