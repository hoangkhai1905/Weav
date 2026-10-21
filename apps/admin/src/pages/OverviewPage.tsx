import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getUpstreams } from '../api/health';
import { getSummary, listExecutions } from '../api/executions';
import { listUsers } from '../api/users';
import { listWorkspaces } from '../api/workspaces';
import { UpstreamPill } from '../components/UpstreamPill';
import { QueryBody, QueryCard } from '../components/overview/QueryCard';
import { useFormatDateTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { getProfile } from '../lib/session';
import { CARD } from '../lib/ui';

const bigNumber = 'text-2xl font-semibold tabular-nums';
const linkCls = 'text-[13px] font-medium text-accent-ink hover:underline';

/** The big picture: a few counters, the latest failed runs and whether the services are up. Every block loads on its own. */
export function OverviewPage() {
  const t = useT();
  const formatDateTime = useFormatDateTime();
  const profile = getProfile();

  const users = useQuery({ queryKey: ['admin', 'overview', 'users'], queryFn: () => listUsers({ page: 0, size: 1 }) });
  const disabled = useQuery({ queryKey: ['admin', 'overview', 'disabled'], queryFn: () => listUsers({ page: 0, size: 1, status: 'DISABLED' }) });
  const workspaces = useQuery({ queryKey: ['admin', 'overview', 'workspaces'], queryFn: () => listWorkspaces({ page: 0, size: 1 }) });
  const summary = useQuery({ queryKey: ['admin', 'overview', 'summary'], queryFn: () => getSummary(24) });
  const failed = useQuery({ queryKey: ['admin', 'overview', 'failed'], queryFn: () => listExecutions({ status: 'FAILED', page: 0, size: 5 }) });
  const health = useQuery({ queryKey: ['admin', 'upstreams'], queryFn: getUpstreams });

  // One lookup turns the failed runs' workspace ids into names, like the Executions page.
  const wsIds = useMemo(() => [...new Set((failed.data?.items ?? []).map((run) => run.workspaceId))].sort(), [failed.data]);
  const names = useQuery({
    queryKey: ['admin', 'workspace-names', wsIds],
    queryFn: () => listWorkspaces({ ids: wsIds, size: 100 }),
    enabled: wsIds.length > 0,
  });
  const nameOf = (id: string) => names.data?.items.find((w) => w.id === id)?.name ?? '—';

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div>
        <h1 className="text-xl font-semibold">{t('overview.title')}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{t('overview.subtitle', { name: profile?.displayName?.trim() || profile?.email || '' })}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <QueryCard title={t('overview.users_total')} testId="tile-users" query={users}>
          {(data) => <p data-testid="overview-users-total" className={bigNumber}>{data.totalItems}</p>}
        </QueryCard>
        <QueryCard title={t('overview.disabled')} testId="tile-disabled" query={disabled}>
          {(data) => <p data-testid="overview-disabled-total" className={bigNumber}>{data.totalItems}</p>}
        </QueryCard>
        <QueryCard title={t('overview.workspaces')} testId="tile-workspaces" query={workspaces}>
          {(data) => <p data-testid="overview-workspaces-total" className={bigNumber}>{data.totalElements}</p>}
        </QueryCard>
        <QueryCard title={t('overview.runs')} testId="tile-runs" query={summary}>
          {(data) => (
            <>
              <p data-testid="overview-runs-total" className={bigNumber}>{data.total}</p>
              <p className="mt-1 text-xs text-text-2">{t('overview.runs_breakdown', { success: data.success, failed: data.failed, active: data.active })}</p>
            </>
          )}
        </QueryCard>
      </div>

      <section className={`${CARD} p-4`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t('overview.failed_title')}</h2>
          <Link to="/executions" className={linkCls}>{t('overview.failed_all')}</Link>
        </div>
        <div className="mt-2">
          <QueryBody query={failed}>
            {(data) =>
              data.items.length === 0 ? (
                <p className="py-4 text-[13px] text-text-2">{t('overview.failed_empty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.items.map((run) => (
                    <li key={run.executionId}>
                      <Link to="/executions" data-testid="failed-run-row" className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[13px] hover:bg-subtle">
                        <span className="min-w-0 flex-1 basis-48 truncate font-medium">{run.workflowName}</span>
                        <span className="w-40 truncate text-text-2">{nameOf(run.workspaceId)}</span>
                        <time dateTime={run.startedAt ?? run.createdAt} className="w-36 whitespace-nowrap tabular-nums text-text-2">{formatDateTime(run.startedAt ?? run.createdAt)}</time>
                        <span className="w-32 truncate text-xs text-err">{run.errorCode ?? '—'}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryBody>
        </div>
      </section>

      <QueryCard title={t('overview.health_title')} testId="overview-health" query={health}>
        {(data) => (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <span className="inline-flex items-center gap-2">{t('sys.identity')} <UpstreamPill state={data.details.identity.status} /></span>
            <span className="inline-flex items-center gap-2">{t('sys.workspace')} <UpstreamPill state={data.details.workspace.status} /></span>
            <Link to="/system" className={`${linkCls} ml-auto`}>{t('overview.health_link')}</Link>
          </div>
        )}
      </QueryCard>
    </div>
  );
}
