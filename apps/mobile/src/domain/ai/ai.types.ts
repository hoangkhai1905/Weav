import type { WorkflowDefinition, WorkflowNode } from '../workflow/workflow.types';

export type AiQuestionCode = 'URL' | 'SCHEDULE' | 'TIMEZONE' | 'VALUE' | 'CONNECTION';
export type AiUnsupportedReasonCode =
  | 'CAPABILITY_UNAVAILABLE'
  | 'OUT_OF_SCOPE'
  | 'AMBIGUOUS_REQUEST'
  | 'INVALID_INTENT';

export interface AiGenerateRequest {
  /** 1..4000 characters (the gateway allows 16000 but the service rejects above 4000). */
  prompt: string;
  timezone?: string;
  /** nodeType -> connection uuid; answers a CONNECTION question. */
  connections?: Record<string, string>;
  /** field -> text; answers URL / SCHEDULE / TIMEZONE / VALUE questions (max 10). */
  answers?: Record<string, string>;
}

export interface AiQuestion {
  code: AiQuestionCode;
  /** VALUE: "<nodeType>.<field>"; CONNECTION: the node type, for example "email.send". */
  field: string;
}

export interface AiGeneratedWorkflow {
  name: string;
  /** Kept as-is: saving a draft sends this definition back. */
  definition: WorkflowDefinition;
  nodes: WorkflowNode[];
  edges: WorkflowDefinition['edges'];
  layout: Record<string, { x: number; y: number }>;
}

export type AiGenerationResult =
  | ({ status: 'ready' } & AiGeneratedWorkflow)
  | { status: 'needs_input'; questions: AiQuestion[] }
  | { status: 'unsupported'; reasons: { code: AiUnsupportedReasonCode }[] };

export interface AiRepository {
  generateWorkflow(workspaceId: string, request: AiGenerateRequest): Promise<AiGenerationResult>;
}

export type AIRepository = AiRepository;
