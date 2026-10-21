import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getUpstreams } from '../api/health';
import { getSummary, listExecutions } from '../api/executions';
import { listUsers } from '../api/users';
import { listWorkspaces } from '../api/workspaces';
import { UpstreamPill } from '../components/UpstreamPill';
import { QueryBody, QueryCard } from '../components/overview/QueryCard';
import { RunsTrendChart } from '../components/overview/RunsTrendChart';
import { TopFailingList } from '../components/overview/TopFailingList';
import { useFormatDateTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { getProfile } from '../lib/session';
import { btnCls, CARD } from '../lib/ui';

const bigNumber = 'text-2xl font-semibold tabular-nums';
const linkCls = 'text-[13px] font-medium text-accent-ink hover:underline';
const RANGES = [7, 14, 30] as const;

/** The big picture: counters, runs per day, the latest and most failing runs and whether the services are up. Every block loads on its own. */
export function OverviewPage() {
  const t = useT();
  const formatDateTime = useFormatDateTime();
  const profile = getProfile();
  const [days, setDays] = useState<(typeof RANGES)[number]>(14);

  const users = useQuery({ queryKey: ['admin', 'overview', 'users'], queryFn: () => listUsers({ page: 0, size: 1 }) });
  const disabled = useQuery({ queryKey: ['admin', 'overview', 'disabled'], queryFn: () => listUsers({ page: 0, size: 1, status: 'DISABLED' }) });
  const workspaces = useQuery({ queryKey: ['admin', 'overview', 'workspaces'], queryFn: () => listWorkspaces({ page: 0, size: 1 }) });
  const summary = useQuery({ queryKey: ['admin', 'overview', 'summary'], queryFn: () => getSummary(24) });
  const failed = useQuery({ queryKey: ['admin', 'overview', 'failed'], queryFn: () => listExecutions({ status: 'FAILED', page: 0, size: 5 }) });
  // The charts have their own query (and key), so switching the range never reloads the 24 h tiles.
  const trend = useQuery({ queryKey: ['admin', 'overview', 'trend', days], queryFn: () => getSummary(24, days), placeholderData: keepPreviousData });
  const health = useQuery({ queryKey: ['admin', 'upstreams'], queryFn: getUpstreams });

  // One lookup turns the workspace ids of the failed runs and the top-failing list into names, like the Executions page.
  // It starts as soon as either source has ids and keeps the previous names while a new range loads, so names never blink to a dash.
  const wsIds = useMemo(
    () => [...new Set([...(failed.data?.items ?? []).map((run) => run.workspaceId), ...(trend.data?.topFailing ?? []).map((row) => row.workspaceId)])].sort(),
    [failed.data, trend.data],
  );
  const names = useQuery({
    queryKey: ['admin', 'workspace-names', wsIds],
    queryFn: () => listWorkspaces({ ids: wsIds, size: 100 }),
    enabled: wsIds.length > 0,
    placeholderData: keepPreviousData,
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
          {(data) => {
            const other = data.total - data.success - data.failed - data.active;
            return (
            <>
              <p data-testid="overview-runs-total" className={bigNumber}>{data.total}</p>
              {/* Cancelled runs are only in the total, so the remainder keeps the breakdown adding up. */}
              <p className="mt-1 text-xs text-text-2">
                {t('overview.runs_breakdown', { success: data.success, failed: data.failed, active: data.active })}
                {other > 0 && <span data-testid="overview-runs-other">{` · ${t('overview.runs_other', { count: other })}`}</span>}
              </p>
            </>
            );
          }}
        </QueryCard>
      </div>

      <section data-testid="overview-trend" className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="text-sm font-semibold">{t('overview.trend_title')}</h2>
          <div role="group" aria-label={t('overview.range_label')} className="flex gap-1">
            {RANGES.map((range) => (
              <button key={range} type="button" aria-pressed={days === range} onClick={() => setDays(range)} className={`${btnCls} ${days === range ? 'border-primary bg-subtle' : ''}`}>
                {t('overview.range_days', { count: range })}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <QueryBody query={trend}>
            {(data) =>
              data.trend.every((day) => day.total === 0) ? (
                <p className="py-4 text-[13px] text-text-2">{t('overview.trend_empty')}</p>
              ) : (
                <RunsTrendChart trend={data.trend} />
              )
            }
          </QueryBody>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={`${CARD} min-w-0 p-4`}>
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

        <section data-testid="overview-top-failing" className={`${CARD} min-w-0 p-4`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">{t('overview.top_title')}</h2>
            <span className="text-xs text-text-2">{t('overview.top_period', { days })}</span>
          </div>
          <div className="mt-2">
            <QueryBody query={trend}>{(data) => <TopFailingList rows={data.topFailing} nameOf={nameOf} />}</QueryBody>
          </div>
        </section>
      </div>

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
