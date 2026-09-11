import type { Workflow } from '../workflow/workflow.types';

export interface AiGenerationResult {
  prompt: string;
  reasoning: string;
  workflowPreview: Workflow;
  validation: {
    valid: boolean;
    warnings: string[];
  };
}

export interface AiRepository {
  generateWorkflow(prompt: string): Promise<AiGenerationResult>;
}

export type AIRepository = AiRepository;
