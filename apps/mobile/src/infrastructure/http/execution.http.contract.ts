import type { AxiosRequestConfig } from 'axios';
import type {
  ExecutionDetailQuery,
  ExecutionListQuery,
} from '../../domain/execution/execution.types';
import { isUuid } from './notification.http.contract';
import { buildPageParams, workflowPath } from './workflow.http.contract';

/** Client-side aggregation limits (see listRecentWorkspaceExecutions). */
export const RECENT_EXECUTION_WORKFLOW_LIMIT = 20;
export const RECENT_EXECUTION_PAGE_SIZE = 10;

export function executionsPath(workspaceId: string, workflowId: string): string {
  return `${workflowPath(workspaceId, workflowId)}/executions`;
}

export function buildExecutionListRequest(
  workspaceId: string,
  workflowId: string,
  query: ExecutionListQuery = {},
  signal?: AbortSignal,
): AxiosRequestConfig {
  return {
    url: executionsPath(workspaceId, workflowId),
    params: buildPageParams(query),
    ...(signal ? { signal } : {}),
  };
}

export function buildExecutionDetailRequest(
  workspaceId: string,
  workflowId: string,
  executionId: string,
  query: ExecutionDetailQuery = {},
  signal?: AbortSignal,
): AxiosRequestConfig {
  if (!isUuid(executionId)) throw new Error('Invalid execution id.');
  const logParams = buildPageParams({ page: query.logPage, size: query.logSize });
  return {
    url: `${executionsPath(workspaceId, workflowId)}/${executionId}`,
    params: {
      ...(logParams.page !== undefined ? { logPage: logParams.page } : {}),
      ...(logParams.size !== undefined ? { logSize: logParams.size } : {}),
    },
    ...(signal ? { signal } : {}),
  };
}
