import type {
  Execution,
  ExecutionDetailQuery,
  ExecutionListQuery,
  ExecutionPage,
  ExecutionRepository,
  ExecutionSummary,
} from '../../domain/execution/execution.types';
import {
  RECENT_EXECUTION_PAGE_SIZE,
  RECENT_EXECUTION_WORKFLOW_LIMIT,
  buildExecutionDetailRequest,
  buildExecutionListRequest,
} from './execution.http.contract';
import { mapExecution, mapExecutionPage } from './execution.mapper';
import { requestGateway } from './gateway-request';
import { buildWorkflowListRequest } from './workflow.http.contract';
import { mapWorkflowPage } from './workflow.mapper';

/** Workflows probed when resolving an execution from a notification. */
const RESOLVE_WORKFLOW_LIMIT = 50;

function isMissing(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 403 || status === 404;
}

export class HttpExecutionRepository implements ExecutionRepository {
  listWorkflowExecutions(
    workspaceId: string,
    workflowId: string,
    query: ExecutionListQuery = {},
  ): Promise<ExecutionPage> {
    return requestGateway(
      buildExecutionListRequest(workspaceId, workflowId, query),
      mapExecutionPage,
    );
  }

  /**
   * TEMPORARY client-side aggregation. The backend has no workspace-wide execution
   * history, so this reads the newest 10 executions of up to 20 workflows in parallel,
   * merges them and sorts by createdAt (newest first). Replace the body with one call
   * as soon as such an endpoint exists. A workflow the caller may not monitor (403) or
   * that vanished (404) is skipped; if every workflow fails the first error is thrown.
   */
  async listRecentWorkspaceExecutions(workspaceId: string): Promise<ExecutionSummary[]> {
    const workflows = await requestGateway(
      buildWorkflowListRequest(workspaceId, { page: 0, size: RECENT_EXECUTION_WORKFLOW_LIMIT }),
      mapWorkflowPage,
    );
    const results = await Promise.allSettled(
      workflows.items.map((workflow) =>
        this.listWorkflowExecutions(workspaceId, workflow.workflowId, {
          page: 0,
          size: RECENT_EXECUTION_PAGE_SIZE,
        }),
      ),
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0 && failures.length === results.length) {
      const hard = failures.find((f) => !isMissing(f.reason)) ?? failures[0];
      if (!isMissing(hard.reason)) throw hard.reason;
    }
    return results
      .flatMap((r) => (r.status === 'fulfilled' ? r.value.items : []))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  getExecution(
    workspaceId: string,
    workflowId: string,
    executionId: string,
    query: ExecutionDetailQuery = {},
  ): Promise<Execution> {
    return requestGateway(
      buildExecutionDetailRequest(workspaceId, workflowId, executionId, query),
      mapExecution,
    );
  }

  /**
   * CONTRACT LIMITATION (the only place that does this): an execution is only readable as
   * workflows/{wf}/executions/{ex}, and an EXECUTION notification carries no workflowId.
   * So the workspace's first 50 workflows are probed in parallel (the wrong pair answers
   * 404). Executions of workflows beyond the first 50 cannot be opened from a notification.
   */
  async findWorkflowIdForExecution(
    workspaceId: string,
    executionId: string,
  ): Promise<string | null> {
    const workflows = await requestGateway(
      buildWorkflowListRequest(workspaceId, { page: 0, size: RESOLVE_WORKFLOW_LIMIT }),
      mapWorkflowPage,
    );
    const results = await Promise.allSettled(
      workflows.items.map(async (workflow) => {
        await this.getExecution(workspaceId, workflow.workflowId, executionId, { logSize: 1 });
        return workflow.workflowId;
      }),
    );
    const found = results.find((r) => r.status === 'fulfilled');
    if (found && found.status === 'fulfilled') return found.value;
    const hard = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected' && !isMissing(r.reason),
    );
    if (hard) throw hard.reason;
    return null;
  }
}
