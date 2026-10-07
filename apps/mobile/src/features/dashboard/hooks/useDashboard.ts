import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { workflowRepository } from '../../../infrastructure/repository-factory';
import { useExecutions } from '../../executions/hooks/useExecutions';
import { useConnections } from '../../connections/hooks/useConnections';
import { useWorkflows } from '../../workflows/hooks/useWorkflows';
import { useActiveWorkspaceId } from '../../workspace/active-workspace';
import {
  collectAttention,
  countWorkflowsByStatus,
  summarizeRuns,
  type AttentionItem,
  type RunSummary,
  type WorkflowTriggers,
} from '../dashboard.stats';
import type { WorkflowStatus } from '../../../domain/workflow/workflow.types';

/** Triggers live only on the workflow detail, so at most this many published workflows are checked. */
export const TRIGGER_CHECK_LIMIT = 10;

export interface DashboardData {
  isPending: boolean;
  /** First error of the two core queries (workflows / runs); drives the full-screen ErrorState. */
  error: unknown;
  workflowTotal: number;
  byStatus: Record<WorkflowStatus, number>;
  runs: RunSummary;
  recentRuns: ReturnType<typeof useExecutions>['data'];
  attention: AttentionItem[];
  refetch: () => Promise<void>;
  isRefetching: boolean;
}

export function useDashboard(): DashboardData {
  const workspaceId = useActiveWorkspaceId();
  const workflows = useWorkflows();
  const executions = useExecutions();
  const connections = useConnections();

  const toCheck = useMemo(
    () => (workflows.data ?? []).filter((w) => w.status !== 'DRAFT').slice(0, TRIGGER_CHECK_LIMIT),
    [workflows.data],
  );
  // Same query key as the workflow detail screen, so opening a workflow later hits the cache.
  const details = useQueries({
    queries: toCheck.map((w) => ({
      queryKey: ['workflow', workspaceId, w.workflowId],
      queryFn: () => workflowRepository.getWorkflow(workspaceId ?? '', w.workflowId),
      enabled: !!workspaceId,
      staleTime: 30_000,
    })),
  });

  const detailKey = details.map((d) => d.dataUpdatedAt).join(',');
  const attention = useMemo(() => {
    const triggers: WorkflowTriggers[] = [];
    details.forEach((d) => {
      if (d.data) triggers.push({ workflowId: d.data.workflowId, name: d.data.name, triggers: d.data.triggers });
    });
    return collectAttention({
      executions: executions.data ?? [],
      workflows: triggers,
      connections: connections.data ?? [],
    });
    // details is rebuilt on every render; dataUpdatedAt identifies real changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executions.data, connections.data, detailKey]);

  const byStatus = useMemo(() => countWorkflowsByStatus(workflows.data ?? []), [workflows.data]);
  const runs = useMemo(() => summarizeRuns(executions.data ?? []), [executions.data]);

  return {
    isPending: workflows.isPending || executions.isPending,
    error: workflows.error ?? executions.error,
    workflowTotal: workflows.data?.length ?? 0,
    byStatus,
    runs,
    recentRuns: executions.data,
    attention,
    isRefetching: workflows.isRefetching || executions.isRefetching,
    refetch: async () => {
      await Promise.all([workflows.refetch(), executions.refetch(), connections.refetch()]);
    },
  };
}
