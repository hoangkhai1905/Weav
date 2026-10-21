import { api } from './client';

export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
export type StepStatus = 'PENDING' | 'READY' | 'RUNNING' | 'WAITING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
export type TriggerType = 'MANUAL' | 'SCHEDULE' | 'WEBHOOK' | 'TELEGRAM' | 'GMAIL' | 'WORKFLOW_EVENT';

export interface ExecutionRow {
  executionId: string;
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  status: ExecutionStatus;
  triggerType: TriggerType;
  createdAt: string;
  startedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
}

export interface ExecutionPage {
  items: ExecutionRow[];
  page: number;
  size: number;
  totalElements: number;
  hasNext: boolean;
}

export interface ExecutionStep {
  nodeId: string;
  nodeType: string;
  status: StepStatus;
  attemptCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ExecutionDetail {
  executionId: string;
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  status: ExecutionStatus;
  triggerType: TriggerType;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  steps: ExecutionStep[];
}

export interface ExecutionSummary {
  hours: number;
  from: string;
  to: string;
  total: number;
  success: number;
  failed: number;
  active: number;
}

export interface ListExecutionsParams {
  status?: ExecutionStatus;
  workspaceId?: string;
  from?: string;
  to?: string;
  page: number;
  size: number;
}

/** Unset filters are left out: the server rejects unknown query keys. */
export const listExecutions = async ({ status, workspaceId, from, to, page, size }: ListExecutionsParams): Promise<ExecutionPage> =>
  (await api.get<ExecutionPage>('/api/admin/executions', { params: { status, workspaceId, from, to, page, size } })).data;

export const getExecution = async (executionId: string): Promise<ExecutionDetail> =>
  (await api.get<ExecutionDetail>(`/api/admin/executions/${encodeURIComponent(executionId)}`)).data;

export const getSummary = async (hours: number): Promise<ExecutionSummary> =>
  (await api.get<ExecutionSummary>('/api/admin/executions/summary', { params: { hours } })).data;
