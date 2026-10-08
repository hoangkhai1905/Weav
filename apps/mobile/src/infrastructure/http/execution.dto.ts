/** Raw gateway JSON for .../workflows/{wf}/executions. */
export interface ExecutionSummaryDto {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  status: string;
  triggerType: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ExecutionPageDto {
  items: ExecutionSummaryDto[];
  page: number;
  size: number;
  totalElements: number;
  hasNext: boolean;
}

export interface NodeAttemptDto {
  attemptId: string;
  attemptNumber: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  output: unknown;
  error: unknown;
}

export interface NodeStateDto {
  nodeExecutionId: string;
  nodeId: string;
  nodeType: string;
  status: string;
  attemptCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  output: unknown;
  error: unknown;
  attempts: NodeAttemptDto[];
}

export interface LogEntryDto {
  id: string;
  nodeExecutionId: string | null;
  attemptId: string | null;
  level: string;
  eventType: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface LogPageDto {
  items: LogEntryDto[];
  page: number;
  size: number;
  totalElements: number;
  hasNext: boolean;
}

export interface ExecutionDetailDto extends ExecutionSummaryDto {
  nodes: NodeStateDto[];
  logs: LogPageDto;
}
