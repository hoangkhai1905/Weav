import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { monitoringApi, type RunStatus } from '../api/monitoring.api';
import { WorkflowApiError } from '../api/workflow-v1.api';
import { workflowApi } from '../api/workflow.api';
import { AlertRulesPanel } from '../components/monitoring/AlertRulesPanel';
import { MonitoringSummaryPanel } from '../components/monitoring/MonitoringSummaryPanel';
import { statusBadgeClass } from '../components/common/statusBadgeClass';
import { appLocale } from '../lib/i18n/tr';
import { workflowListKey } from '../lib/queries/workflows';
import { dayEndExclusiveIso, dayStartIso, formatDurationMs, RUN_STATUSES, runTone } from '../lib/monitoring/format';
import { triggerTypeLabel } from '../lib/executions/runView';
import { formatRelativeTime } from '../lib/relativeTime';
import { useI18nStore } from '../store/useI18nStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

const PAGE_SIZE = 20;
const MAX_RANGE_DAYS = 90;
const DAY_MS = 86_400_000;

type Tab = 'runs' | 'rules';

const fieldCls = 'h-8 rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
const btnCls = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const th = 'h-8 whitespace-nowrap border-b border-border bg-subtle px-3 text-left text-xs font-medium text-muted-foreground';
const td = 'h-10 border-b border-border px-3';

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Workspace "giám sát" page: metrics, filtered run history and alert rules. Route: /executions. */
export function ExecutionsOverviewPage() {
  const { t } = useI18nStore();
  const locale = appLocale();
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId) ?? 'active';
  const [tab, setTab] = useState<Tab>('runs');
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState<RunStatus | ''>('');
  const [workflowId, setWorkflowId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);
  // Captured once: render must stay pure, and a day of drift cannot matter for a 90-day check.
  const [mountedAt] = useState(() => Date.now());

  const from = fromDate ? dayStartIso(fromDate) : undefined;
  const to = toDate ? dayEndExclusiveIso(toDate) : undefined;
  const rangeTooLong = Boolean(from && to && Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * DAY_MS);
  const rangeInverted = Boolean(from && to && Date.parse(to) <= Date.parse(from));
  // The server caps every history query at 90 days, so a start date older than that needs an end date.
  const rangeTooOld = Boolean(from && !to && mountedAt - Date.parse(from) > MAX_RANGE_DAYS * DAY_MS);
  const rangeError = rangeTooLong
    ? t('monitoring.err_range_long')
    : rangeTooOld
      ? t('monitoring.err_range_old')
      : rangeInverted
        ? t('monitoring.err_range_order')
        : null;

  const workflowsQuery = useQuery({
    queryKey: workflowListKey(),
    queryFn: () => workflowApi.getWorkflows(),
    staleTime: 30_000,
    retry: false,
  });
  const workflows = useMemo(() => (workflowsQuery.data ?? []).map((workflow) => ({ id: workflow.id, name: workflow.name })), [workflowsQuery.data]);

  const summaryQuery = useQuery({
    queryKey: ['monitoring', 'summary', workspaceId, days],
    queryFn: () => monitoringApi.getSummary(days),
    staleTime: 30_000,
    retry: false,
  });
  const runsQuery = useQuery({
    queryKey: ['monitoring', 'runs', workspaceId, status, workflowId, from ?? '', to ?? '', page],
    queryFn: () => monitoringApi.listRuns({
      page,
      size: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(workflowId ? { workflowId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    enabled: !rangeError,
    placeholderData: (previous) => previous,
    retry: false,
  });

  const runs = rangeError ? undefined : runsQuery.data;
  // A server-side range rejection is shown in the user's language, not as the raw English message.
  const runsErrorText = runsQuery.error instanceof WorkflowApiError && runsQuery.error.status === 400
    && /time range/i.test(runsQuery.error.message)
    ? t('monitoring.err_range_long')
    : errorText(runsQuery.error, t('monitoring.runs_error'));
  const totalPages = runs ? Math.max(1, Math.ceil(runs.totalElements / runs.size)) : 1;
  const filtered = Boolean(status || workflowId || fromDate || toDate);
  const refreshing = summaryQuery.isFetching || runsQuery.isFetching;
  const refresh = () => {
    void summaryQuery.refetch();
    if (!rangeError) void runsQuery.refetch();
  };
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(0);
  };
  const clearFilters = () => changeFilter(() => {
    setStatus('');
    setWorkflowId('');
    setFromDate('');
    setToDate('');
  });

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-12">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('executions.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t('monitoring.subtitle')}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-2">
          {t('monitoring.range_label')}
          <select className={fieldCls} value={days} onChange={(event) => setDays(Number(event.target.value))} data-testid="monitoring-days">
            {[7, 14, 30].map((value) => <option key={value} value={value}>{t('monitoring.last_days').replace('{days}', String(value))}</option>)}
          </select>
        </label>
        <button type="button" className={btnCls} onClick={refresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />{t('monitoring.refresh')}
        </button>
      </header>

      {summaryQuery.isLoading ? (
        <p role="status" data-testid="monitoring-summary-loading" className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{t('monitoring.loading')}</p>
      ) : summaryQuery.isError ? (
        <div role="alert" data-testid="monitoring-summary-error" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{errorText(summaryQuery.error, t('monitoring.summary_error'))}</span>
          <button type="button" className="font-medium underline" onClick={() => void summaryQuery.refetch()}>{t('monitoring.retry')}</button>
        </div>
      ) : summaryQuery.data ? (
        <MonitoringSummaryPanel summary={summaryQuery.data} />
      ) : null}

      <div role="tablist" aria-label={t('monitoring.tabs')} className="flex gap-1 border-b border-border">
        {(['runs', 'rules'] as const).map((value) => (
          <button key={value} type="button" role="tab" id={`monitoring-tab-${value}`} aria-selected={tab === value} aria-controls={`monitoring-panel-${value}`}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t(value === 'runs' ? 'monitoring.tab_runs' : 'monitoring.tab_rules')}
          </button>
        ))}
      </div>

      {tab === 'rules' ? (
        <div role="tabpanel" id="monitoring-panel-rules" aria-labelledby="monitoring-tab-rules">
          <AlertRulesPanel workflows={workflows} />
        </div>
      ) : (
        <div role="tabpanel" id="monitoring-panel-runs" aria-labelledby="monitoring-tab-runs" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3" data-testid="monitoring-filters">
            <label className="text-xs font-medium text-text-2">
              {t('executions.col_status')}
              <select className={`${fieldCls} mt-1 block`} value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value as RunStatus | ''))} data-testid="monitoring-filter-status">
                <option value="">{t('monitoring.all_statuses')}</option>
                {RUN_STATUSES.map((value) => <option key={value} value={value}>{t(`monitoring.status.${value.toLowerCase()}`)}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-text-2">
              {t('executions.col_workflow')}
              <select className={`${fieldCls} mt-1 block max-w-[240px]`} value={workflowId} onChange={(event) => changeFilter(() => setWorkflowId(event.target.value))} data-testid="monitoring-filter-workflow">
                <option value="">{t('monitoring.all_workflows')}</option>
                {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-text-2">
              {t('monitoring.from_date')}
              <input type="date" className={`${fieldCls} mt-1 block`} value={fromDate} max={toDate || undefined} onChange={(event) => changeFilter(() => setFromDate(event.target.value))} data-testid="monitoring-filter-from" />
            </label>
            <label className="text-xs font-medium text-text-2">
              {t('monitoring.to_date')}
              <input type="date" className={`${fieldCls} mt-1 block`} value={toDate} min={fromDate || undefined} onChange={(event) => changeFilter(() => setToDate(event.target.value))} data-testid="monitoring-filter-to" />
            </label>
            {filtered && <button type="button" className={btnCls} onClick={clearFilters}>{t('monitoring.clear_filters')}</button>}
          </div>
          {rangeError && <p role="alert" data-testid="monitoring-range-error" className="text-[13px] text-err">{rangeError}</p>}

          {runsQuery.isError && !rangeError ? (
            <div role="alert" data-testid="monitoring-runs-error" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{runsErrorText}</span>
              <button type="button" className="font-medium underline" onClick={() => void runsQuery.refetch()}>{t('monitoring.retry')}</button>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[860px] border-collapse text-[13px]" data-testid="monitoring-runs-table">
              <caption className="sr-only">{t('monitoring.runs_caption')}</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t('executions.col_status')}</th>
                  <th scope="col" className={th}>{t('executions.col_workflow')}</th>
                  <th scope="col" className={th}>{t('monitoring.col_trigger')}</th>
                  <th scope="col" className={th}>{t('executions.col_started')}</th>
                  <th scope="col" className={`${th} text-right`}>{t('executions.col_duration')}</th>
                  <th scope="col" className={th}>{t('monitoring.col_error')}</th>
                  <th scope="col" className={`${th} text-right`}>{t('executions.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {(runs?.items ?? []).map((run) => {
                  const started = run.startedAt ?? run.createdAt;
                  return (
                    <tr key={run.executionId} data-testid="monitoring-run-row" className="transition-colors hover:bg-subtle">
                      <td className={td}><span className={statusBadgeClass(runTone(run.status))}>{t(`monitoring.status.${run.status.toLowerCase()}`)}</span></td>
                      <td className={`${td} max-w-[240px] truncate font-medium text-foreground`} title={run.workflowName}>
                        <Link to={`/workflows/${encodeURIComponent(run.workflowId)}/executions`} className="hover:underline">{run.workflowName}</Link>
                      </td>
                      <td className={`${td} text-text-2`}>{triggerTypeLabel(run.triggerType, t)}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums text-text-2`}>
                        <time dateTime={started} title={new Date(started).toLocaleString(locale)}>{formatRelativeTime(started, locale)}</time>
                      </td>
                      <td className={`${td} whitespace-nowrap text-right font-mono text-xs tabular-nums text-text-2`}>{formatDurationMs(run.durationMs, locale)}</td>
                      <td className={`${td} max-w-[260px] truncate text-xs text-text-2`} title={run.errorMessage ?? undefined}>
                        {run.errorCode ?? (run.errorMessage ? run.errorMessage : '')}
                      </td>
                      <td className={`${td} text-right`}>
                        <Link
                          to={`/executions/${encodeURIComponent(run.executionId)}?workflowId=${encodeURIComponent(run.workflowId)}`}
                          aria-label={`${t('executions.view_trace')}: ${run.workflowName}`}
                          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-text-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ExternalLink size={13} aria-hidden="true" />{t('executions.view_trace')}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {!runsQuery.isLoading && !rangeError && runs && runs.items.length === 0 && (
                  <tr><td colSpan={7} data-testid="monitoring-runs-empty" className="px-3 py-12 text-center text-[13px] text-text-2">
                    {filtered ? t('monitoring.runs_empty_filtered') : t('monitoring.runs_empty')}
                  </td></tr>
                )}
              </tbody>
            </table>
            {runsQuery.isLoading && <div role="status" className="flex justify-center py-10"><LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('monitoring.loading')} /></div>}
          </div>

          {runs && runs.totalElements > 0 && (
            <nav aria-label={t('monitoring.pagination')} className="flex items-center justify-end gap-3 text-xs text-text-2">
              <span data-testid="monitoring-page-info" className="tabular-nums">
                {t('monitoring.page_info').replace('{page}', String(runs.page + 1)).replace('{pages}', String(totalPages)).replace('{total}', String(runs.totalElements))}
              </span>
              <button type="button" className={btnCls} disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>{t('monitoring.prev')}</button>
              <button type="button" className={btnCls} disabled={!runs.hasNext} onClick={() => setPage((current) => current + 1)} data-testid="monitoring-next">{t('monitoring.next')}</button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
