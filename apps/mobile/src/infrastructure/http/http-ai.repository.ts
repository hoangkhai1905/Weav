import type { AIRepository, AiGenerationResult } from '../../domain/ai/ai.types';
import { httpClient, normalizeApiError } from './http-client';

export class HttpAiRepository implements AIRepository {
  async generateWorkflow(prompt: string): Promise<AiGenerationResult> {
    try {
      const res = await httpClient.post<AiGenerationResult>('/api/ai/generate-workflow', { prompt });
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }
}
