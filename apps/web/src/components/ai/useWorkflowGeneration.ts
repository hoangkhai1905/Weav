import { useCallback, useState } from 'react';
import { workflowApi } from '../../api/workflow.api';
import { WorkflowApiError, type GenerationResponse } from '../../api/workflow-v1.api';
import { tr } from '../../lib/i18n/tr';

export type ReadyGeneration = Extract<GenerationResponse, { status: 'ready' }>;

function generationErrorMessage(error: unknown): string {
  if (error instanceof WorkflowApiError) {
    if (error.status === 429) return tr('msg.too_many_requests_wait_a_minute');
    if (error.status === 503) return tr('msg.ai_is_unavailable_right_now');
    if (error.status === 504) return tr('msg.ai_took_too_long_try_a_shorter');
    if (error.status === 400 || error.status === 413) return tr('ai.error.invalid_request');
    if (error.status === 403) return tr('ai.error.no_permission');
    return error.message;
  }
  return error instanceof Error ? error.message : tr('msg.the_workflow_request_could_not_be_completed');
}

/**
 * One call to POST /workflows/generate with shared pending/error/result state.
 * Used by the builder panel and the full-page generator so both behave the same.
 */
export function useWorkflowGeneration() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResponse | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  const generate = useCallback(async (input: { prompt: string; allowBlanks?: boolean }) => {
    setIsPending(true);
    setError(null);
    setResult(null);
    try {
      const generated = await workflowApi.generateWorkflow({
        prompt: input.prompt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(input.allowBlanks ? { allowBlanks: true } : {}),
      });
      setResult(generated);
      return generated;
    } catch (unknown) {
      setError(generationErrorMessage(unknown));
      return null;
    } finally {
      setIsPending(false);
    }
  }, []);

  return { isPending, error, result, generate, reset };
}
