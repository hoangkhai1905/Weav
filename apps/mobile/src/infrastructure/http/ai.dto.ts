import type { WorkflowDefinitionDto } from './workflow.dto';

/** POST /api/v1/workspaces/{ws}/workflows/generate. */
export interface GenerateWorkflowRequestDto {
  prompt: string;
  timezone?: string;
  connections?: Record<string, string>;
  answers?: Record<string, string>;
}

export interface GenerateReadyDto {
  status: 'ready';
  name: string;
  definition: WorkflowDefinitionDto;
  layout: Record<string, { x: number; y: number }>;
}

export interface GenerateNeedsInputDto {
  status: 'needs_input';
  questions: { code: string; field: string }[];
}

export interface GenerateUnsupportedDto {
  status: 'unsupported';
  reasons: { code: string }[];
}

export type GenerateWorkflowResponseDto =
  | GenerateReadyDto
  | GenerateNeedsInputDto
  | GenerateUnsupportedDto;
