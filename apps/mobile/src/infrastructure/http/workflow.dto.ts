/** Raw gateway JSON for /api/v1/workspaces/{ws}/workflows. Field names match the wire exactly. */
export type WorkflowStatusDto = 'DRAFT' | 'PUBLISHED' | 'PAUSED';

export interface WorkflowSummaryDto {
  workflowId: string;
  name: string;
  description: string | null;
  status: WorkflowStatusDto;
  schemaVersion: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** No `hasNext` and no `totalPages` on this endpoint. */
export interface WorkflowPageDto {
  items: WorkflowSummaryDto[];
  page: number;
  size: number;
  totalElements: number;
}

export interface WorkflowNodeDto {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdgeDto {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
}

export interface WorkflowDefinitionDto {
  schemaVersion: string;
  nodes: WorkflowNodeDto[];
  edges: WorkflowEdgeDto[];
  variables?: Record<string, unknown>;
}

/** Written by the web editor; absent for AI generated workflows. */
export interface EditorStateDto {
  nodes?: Record<string, { name?: string; position?: { x: number; y: number } }>;
}

export interface WorkflowTriggerDto {
  triggerId: string;
  type: string;
  status: string;
  reasonCode: string | null;
  nextRunAt: string | null;
  lastTriggeredAt: string | null;
}

export interface WorkflowResponseDto extends WorkflowSummaryDto {
  definition: WorkflowDefinitionDto;
  editorState: EditorStateDto | null;
  revision: number;
  triggers: WorkflowTriggerDto[];
}

/** POST .../executions -> 202. */
export interface ManualExecutionAcceptedDto {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  status: 'QUEUED';
}

/** POST .../executions request body (zod .strict(): `input` is required). */
export interface ManualExecutionRequestDto {
  input: Record<string, unknown>;
}
