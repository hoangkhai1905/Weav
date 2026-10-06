import type { QueryClient } from '@tanstack/react-query';
import { workflowApi } from '../../api/workflow.api';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { executionApi } from '../../api/execution.api';
import type { ExecutionDetail, WorkflowDefinition } from '../../types/workflow.types';

const WORKFLOW_LIST_STALE_MS = 30_000;

const workspaceKey = () => useWorkspaceStore.getState().activeWorkspaceId ?? 'active';

export const workflowListKey = () => ['workflows', 'list', workspaceKey()] as const;
/** Raw recent executions shared by the Dashboard and Workflows pages; each derives its own numbers with `select`. */
export const workflowRunStatsKey = () => ['workflows', 'run-stats', workspaceKey()] as const;

/** Recent runs of up to 10 non-draft workflows, 3 at a time, so the stats never cost more than 10 requests. */
export async function fetchRecentExecutions(queryClient: QueryClient): Promise<ExecutionDetail[]> {
  return executionApi.getRecentExecutions(await fetchWorkflowList(queryClient), { limit: 10, concurrency: 3 });
}

/** One shared, cached workflow list per workspace (Dashboard, Workflows and Runs pages reuse it). */
export function fetchWorkflowList(queryClient: QueryClient, options: { force?: boolean } = {}): Promise<WorkflowDefinition[]> {
  return queryClient.fetchQuery({
    queryKey: workflowListKey(),
    queryFn: () => workflowApi.getWorkflows(),
    staleTime: options.force ? 0 : WORKFLOW_LIST_STALE_MS,
  });
}

export const invalidateWorkflowQueries = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: ['workflows'] });
