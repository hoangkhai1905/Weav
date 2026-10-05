import type { QueryClient } from '@tanstack/react-query';
import { workflowApi } from '../../api/workflow.api';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import type { WorkflowDefinition } from '../../types/workflow.types';

const WORKFLOW_LIST_STALE_MS = 30_000;

const workspaceKey = () => useWorkspaceStore.getState().activeWorkspaceId ?? 'active';

export const workflowListKey = () => ['workflows', 'list', workspaceKey()] as const;
export const workflowRunStatsKey = () => ['workflows', 'run-stats', workspaceKey()] as const;

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
