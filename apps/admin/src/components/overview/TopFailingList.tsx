import { Link } from 'react-router-dom';
import type { FailingWorkflow } from '../../api/executions';
import { useFormatDateTime } from '../../lib/format';
import { useT } from '../../lib/i18n';

/**
 * Workflows with the most failed runs, each with a bar sized against the worst one. The number is also text,
 * so the bar is decoration. The Runs page only reads `workspaceId` from the URL (its status filter is local state).
 */
export function TopFailingList({ rows, nameOf }: { rows: FailingWorkflow[]; nameOf: (workspaceId: string) => string }) {
  const t = useT();
  const formatDateTime = useFormatDateTime();
  if (rows.length === 0) return <p className="py-4 text-[13px] text-text-2">{t('overview.top_empty')}</p>;
  const max = Math.max(1, ...rows.map((row) => row.failures));
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.workflowId}>
          <Link to={`/executions?workspaceId=${encodeURIComponent(row.workspaceId)}`} data-testid="top-failing-row" className="block py-2.5 text-[13px] hover:bg-subtle">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate font-medium">{row.workflowName}</span>
              <span className="shrink-0 tabular-nums text-err">{t('overview.top_failures', { count: row.failures })}</span>
            </span>
            <span className="mt-1.5 block h-1.5 rounded-full bg-err-bg" aria-hidden="true">
              <span data-testid="top-failing-bar" className="block h-full rounded-full bg-err" style={{ width: `${Math.round((row.failures / max) * 100)}%` }} />
            </span>
            <span className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-text-2">
              <span className="min-w-0 truncate">{nameOf(row.workspaceId)}</span>
              <span className="whitespace-nowrap">{t('overview.top_last', { time: formatDateTime(row.lastFailureAt) })}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
