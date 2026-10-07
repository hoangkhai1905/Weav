import type { ConnectionItem } from '../../domain/connection/connection.types';
import type { ExecutionSummary } from '../../domain/execution/execution.types';
import type {
  WorkflowStatus,
  WorkflowSummary,
  WorkflowTrigger,
  WorkflowTriggerReasonCode,
} from '../../domain/workflow/workflow.types';

/**
 * Dashboard numbers are computed on the client from what is already loaded (there is no stats
 * endpoint). Every figure therefore describes a SAMPLE, and the UI says so ("in the last N runs").
 */
export interface RunSummary {
  /** Number of runs in the loaded sample. */
  sample: number;
  active: number;
  success: number;
  failed: number;
  cancelled: number;
  /** Whole percent of SUCCESS among finished (SUCCESS + FAILED) runs; null when none finished. */
  successRate: number | null;
}

export function countWorkflowsByStatus(
  workflows: readonly Pick<WorkflowSummary, 'status'>[],
): Record<WorkflowStatus, number> {
  const out: Record<WorkflowStatus, number> = { DRAFT: 0, PUBLISHED: 0, PAUSED: 0 };
  for (const w of workflows) if (w.status in out) out[w.status] += 1;
  return out;
}

export function summarizeRuns(executions: readonly Pick<ExecutionSummary, 'status'>[]): RunSummary {
  let active = 0;
  let success = 0;
  let failed = 0;
  let cancelled = 0;
  for (const e of executions) {
    if (e.status === 'SUCCESS') success += 1;
    else if (e.status === 'FAILED') failed += 1;
    else if (e.status === 'CANCELLED') cancelled += 1;
    else active += 1;
  }
  const finished = success + failed;
  return {
    sample: executions.length,
    active,
    success,
    failed,
    cancelled,
    successRate: finished === 0 ? null : Math.round((success / finished) * 100),
  };
}

export type AttentionItem =
  | { kind: 'RUN_FAILED'; key: string; workflowId: string; executionId: string; createdAt: string }
  | {
      kind: 'TRIGGER_DISABLED';
      key: string;
      workflowId: string;
      workflowName: string;
      reasonCode: WorkflowTriggerReasonCode | null;
    }
  | {
      kind: 'CONNECTION_INVALID';
      key: string;
      connectionId: string;
      name: string;
      provider: ConnectionItem['provider'];
    };

export interface WorkflowTriggers {
  workflowId: string;
  name: string;
  triggers: readonly Pick<WorkflowTrigger, 'status' | 'reasonCode'>[];
}

export const MAX_FAILED_RUNS_SHOWN = 3;

/** "Needs attention": newest failed runs, disabled triggers, connections that need reconnecting. */
export function collectAttention(input: {
  executions: readonly ExecutionSummary[];
  workflows: readonly WorkflowTriggers[];
  connections: readonly Pick<ConnectionItem, 'id' | 'name' | 'provider' | 'status'>[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const failed = input.executions
    .filter((e) => e.status === 'FAILED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_FAILED_RUNS_SHOWN);
  for (const e of failed) {
    items.push({
      kind: 'RUN_FAILED',
      key: `run:${e.executionId}`,
      workflowId: e.workflowId,
      executionId: e.executionId,
      createdAt: e.createdAt,
    });
  }
  for (const w of input.workflows) {
    const disabled = w.triggers.find((t) => t.status === 'DISABLED');
    if (disabled) {
      items.push({
        kind: 'TRIGGER_DISABLED',
        key: `trigger:${w.workflowId}`,
        workflowId: w.workflowId,
        workflowName: w.name,
        reasonCode: disabled.reasonCode,
      });
    }
  }
  for (const c of input.connections) {
    if (c.status === 'INVALID') {
      items.push({ kind: 'CONNECTION_INVALID', key: `conn:${c.id}`, connectionId: c.id, name: c.name, provider: c.provider });
    }
  }
  return items;
}
