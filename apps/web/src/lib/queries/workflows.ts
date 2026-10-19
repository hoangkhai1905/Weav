import type { QueryClient } from '@tanstack/react-query';
import { workflowApi } from '../../api/workflow.api';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { monitoringApi, type MonitoringRun } from '../../api/monitoring.api';
import type { WorkflowDefinition } from '../../types/workflow.types';

const WORKFLOW_LIST_STALE_MS = 30_000;
/** The workspace run history's largest page. */
const RECENT_RUNS_LIMIT = 100;

const workspaceKey = () => useWorkspaceStore.getState().activeWorkspaceId ?? 'active';

export const workflowListKey = () => ['workflows', 'list', workspaceKey()] as const;
/** Raw recent runs of the workspace; pages derive their own per-workflow numbers with `select`. */
export const workflowRunStatsKey = () => ['workflows', 'run-stats', workspaceKey()] as const;

/**
 * The workspace's most recent runs (newest first) in one request, however many workflows there are.
 * ponytail: one page of 100; a workflow whose runs are all older than the newest 100 shows no stats.
 */
export async function fetchRecentExecutions(): Promise<MonitoringRun[]> {
  return (await monitoringApi.listRuns({ size: RECENT_RUNS_LIMIT })).items;
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
