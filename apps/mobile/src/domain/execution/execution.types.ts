export type ExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export const ACTIVE_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'QUEUED',
  'RUNNING',
  'WAITING',
];

export type ExecutionTriggerType = 'MANUAL' | 'SCHEDULE' | 'WEBHOOK' | 'TELEGRAM' | 'GMAIL';

export type NodeExecutionStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export type ExecutionLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface ExecutionSummary {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  status: ExecutionStatus;
  triggerType: ExecutionTriggerType;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Derived from startedAt/finishedAt; null until both exist. */
  durationMs: number | null;
}

export interface NodeAttempt {
  attemptId: string;
  attemptNumber: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Free-form JSON: the backend defines no fixed schema. */
  output: unknown;
  error: unknown;
}

export interface NodeExecution {
  nodeExecutionId: string;
  nodeId: string;
  nodeType: string;
  status: NodeExecutionStatus;
  attemptCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  output: unknown;
  error: unknown;
  attempts: NodeAttempt[];
}

export interface ExecutionLogItem {
  id: string;
  nodeExecutionId: string | null;
  attemptId: string | null;
  level: ExecutionLogLevel;
  eventType: string;
  message: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ExecutionLogPage {
  items: ExecutionLogItem[];
  page: number;
  size: number;
  totalElements: number;
  hasNext: boolean;
}

export interface Execution extends ExecutionSummary {
  nodes: NodeExecution[];
  logs: ExecutionLogPage;
}

export interface ExecutionPage {
  items: ExecutionSummary[];
  page: number;
  size: number;
  totalElements: number;
  hasNext: boolean;
}

export interface ExecutionListQuery {
  page?: number;
  size?: number;
}

export interface ExecutionDetailQuery {
  logPage?: number;
  logSize?: number;
}

/** The backend has no retry or cancel endpoint, so this repository has neither. */
export interface ExecutionRepository {
  listWorkflowExecutions(
    workspaceId: string,
    workflowId: string,
    query?: ExecutionListQuery,
  ): Promise<ExecutionPage>;
  /**
   * TEMPORARY client-side aggregation until the backend exposes a workspace-wide
   * execution history: newest executions across at most 20 workflows.
   */
  listRecentWorkspaceExecutions(workspaceId: string): Promise<ExecutionSummary[]>;
  getExecution(
    workspaceId: string,
    workflowId: string,
    executionId: string,
    query?: ExecutionDetailQuery,
  ): Promise<Execution>;
  /**
   * CONTRACT LIMITATION: an execution can only be read through its workflow, but
   * an EXECUTION notification carries no workflowId. This is the single place that
   * resolves it, by probing the workspace's workflows. Returns null when not found.
   */
  findWorkflowIdForExecution(workspaceId: string, executionId: string): Promise<string | null>;
}
