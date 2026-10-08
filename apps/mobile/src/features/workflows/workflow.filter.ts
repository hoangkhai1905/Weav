import type { WorkflowStatus, WorkflowSummary } from '../../domain/workflow/workflow.types';

export type WorkflowStatusFilter = 'ALL' | WorkflowStatus;

/** Lower-case and strip Vietnamese diacritics so "bao cao" finds "Báo cáo". */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

/** Client-side only: the backend has no search/filter, so this covers the pages loaded so far. */
export function filterWorkflows(
  items: readonly WorkflowSummary[],
  status: WorkflowStatusFilter,
  query: string,
): WorkflowSummary[] {
  const q = normalizeSearch(query);
  return items.filter(
    (w) =>
      (status === 'ALL' || w.status === status) &&
      (q === '' || normalizeSearch(w.name).includes(q) || normalizeSearch(w.description ?? '').includes(q)),
  );
}
