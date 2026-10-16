// Pure helpers (no react-native import) so Node tests can load them.
import type { ExecutionStatus, ExecutionSummary } from '../../domain/execution/execution.types';
import { normalizeSearch } from '../workflows/workflow.filter';

/** The four result filters of the history list. "running" also covers queued and waiting runs. */
export type RunFilter = 'all' | 'failed' | 'success' | 'running';

export const RUN_FILTERS: readonly RunFilter[] = ['all', 'failed', 'success', 'running'];

const GROUP: Record<ExecutionStatus, Exclude<RunFilter, 'all'> | null> = {
  FAILED: 'failed',
  SUCCESS: 'success',
  RUNNING: 'running',
  QUEUED: 'running',
  WAITING: 'running',
  CANCELLED: null,
};

/** Reads the `filter` route parameter (Home links to `failed` / `running`); anything else means all. */
export function parseRunFilter(value: string | string[] | undefined): RunFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return RUN_FILTERS.includes(v as RunFilter) ? (v as RunFilter) : 'all';
}

export function matchesRunFilter(status: ExecutionStatus, filter: RunFilter): boolean {
  return filter === 'all' || GROUP[status] === filter;
}

/** Search matches the workflow's name (accent-insensitive) or part of the run id. */
export function filterRuns(
  runs: readonly ExecutionSummary[],
  filter: RunFilter,
  query: string,
  nameOf: (workflowId: string) => string,
): ExecutionSummary[] {
  const q = normalizeSearch(query);
  return runs.filter(
    (run) =>
      matchesRunFilter(run.status, filter) &&
      (q === '' || normalizeSearch(nameOf(run.workflowId)).includes(q) || run.executionId.toLowerCase().includes(q)),
  );
}
