import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';
import type { WorkflowDefinition } from '../../../domain/workflow/workflow.types';
import { getActiveWorkspaceId } from '../../workspace/active-workspace';
import { buildEditorState } from '../ai.answers';

export interface GeneratedDraftInput {
  name: string;
  definition: WorkflowDefinition;
  layout: Record<string, { x: number; y: number }>;
  labelOf: (node: { id: string; type: string }) => string;
}

/**
 * "Save draft" = POST create, then PUT draft with the generated definition (+ editorState so the
 * web editor shows node names and positions). If the second call fails the created workflow id is
 * kept, so "try again" completes that workflow instead of creating a duplicate.
 */
export function useSaveGeneratedWorkflow() {
  const queryClient = useQueryClient();
  const createdId = useRef<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (input: GeneratedDraftInput) => {
      const workspaceId = getActiveWorkspaceId();
      if (!createdId.current) {
        const created = await workflowRepository.createWorkflow(workspaceId, { name: input.name });
        createdId.current = created.workflowId;
      }
      await workflowRepository.saveDraft(workspaceId, createdId.current, {
        name: input.name,
        definition: input.definition,
        editorState: buildEditorState(input.definition, input.layout, input.labelOf),
      });
      return createdId.current;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
  return {
    ...mutation,
    /** Forget the half-saved workflow (the user started over). */
    forget: () => {
      createdId.current = null;
      mutation.reset();
    },
  };
}
