import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWorkflowList } from '../lib/queries/workflows';
import { ExecutionsTriPane } from '../components/executions/ExecutionsTriPane';
import { AlertTriangle, Clock3, ExternalLink, LoaderCircle, Play, RefreshCw, Search } from 'lucide-react';
import { executionApi } from '../api/execution.api';
import { isWorkflowMockMode, workflowApi } from '../api/workflow.api';
import type { ExecutionDetail, WorkflowDefinition } from '../types/workflow.types';
import { useI18nStore } from '../store/useI18nStore';
import { statusBadgeClass, type StatusTone } from '../components/common/statusBadgeClass';
import { appLocale, tr } from '../lib/i18n/tr';
import { failureOf, isLiveStatus, useLivePolling, type TickResult } from '../lib/executions/useLivePolling';
import { triggerTypeLabel } from '../lib/executions/runView';

type StatusFilter = 'ALL' | ExecutionDetail['status'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : tr('msg.workflow_service_is_temporarily_unavailable');
}

function statusLabel(status: ExecutionDetail['status'], isVietnamese: boolean): string {
  const labels = isVietnamese
    ? { QUEUED: 'Đang chờ', RUNNING: 'Đang chạy', SUCCESS: 'Thành công', FAILED: 'Thất bại', CANCELLED: tr('runs.status.cancelled') }
    : { QUEUED: 'Queued', RUNNING: 'Running', SUCCESS: 'Success', FAILED: 'Failed', CANCELLED: tr('runs.status.cancelled') };
  return labels[status];
}

function statusTone(status: ExecutionDetail['status']): StatusTone {
  if (status === 'SUCCESS') return 'ok';
  if (status === 'FAILED') return 'err';
  if (status === 'RUNNING' || status === 'QUEUED') return 'run';
  return 'pause';
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString(appLocale()) : value;
}

function duration(execution: ExecutionDetail): string {
  const elapsed = execution.durationMs ?? (
    execution.status === 'RUNNING' || execution.status === 'QUEUED'
      ? Math.max(0, Date.now() - Date.parse(execution.startedAt))
      : undefined
  );
  if (elapsed === undefined || !Number.isFinite(elapsed)) return '—';
  return elapsed < 1000 ? `${elapsed} ms` : `${(elapsed / 1000).toFixed(1)} s`;
}

function LiveGlobalExecutionsPage() {
  const queryClient = useQueryClient();
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { t } = useI18nStore();
  const isVietnamese = t('executions.col_status') === 'Trạng thái';
  const [executions, setExecutions] = useState<ExecutionDetail[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [workflowName, setWorkflowName] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const lastFullRefresh = useRef(0);

  const refresh = useCallback(async (silent = false): Promise<TickResult> => {
    if (isWorkflowMockMode) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [items, workflowItems] = await Promise.all([
        executionApi.getExecutions(workflowId),
        fetchWorkflowList(queryClient),
      ]);
      setExecutions(items);
      setWorkflows(workflowItems);
      lastFullRefresh.current = Date.now();
    } catch (cause) {
      setError(errorMessage(cause));
      return failureOf(cause);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workflowId, queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Every 10 s while any listed run is queued/running. A refresh of every workflow costs 1 + N requests, so a poll
  // only refetches the workflows that have a live run, and falls back to the full refresh at most every 30 s.
  const anyLive = executions.some((execution) => isLiveStatus(execution.status));
  useLivePolling(anyLive, async () => {
    if (Date.now() - lastFullRefresh.current >= 30_000) return refresh(true);
    const liveIds = [...new Set(executions.filter((execution) => isLiveStatus(execution.status)).map((execution) => execution.workflowId))];
    try {
      const fresh = (await Promise.all(liveIds.map((id) => executionApi.getExecutions(id)))).flat();
      setExecutions((current) => [...current.filter((execution) => !liveIds.includes(execution.workflowId)), ...fresh]
        .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)));
      return true;
    } catch (cause) {
      return failureOf(cause);
    }
  }, 10_000);

  const filtered = useMemo(() => executions.filter((execution) => {
    if (status !== 'ALL' && execution.status !== status) return false;
    if (workflowName !== 'ALL' && execution.workflowName !== workflowName) return false;
    const query = search.trim().toLocaleLowerCase();
    if (!query) return true;
    return [execution.id, execution.workflowName, execution.triggerType]
      .some((value) => value.toLocaleLowerCase().includes(query));
  }), [executions, search, status, workflowName]);

  const rerun = async (execution: ExecutionDetail) => {
    setNotice(null);
    try {
      const workflow = await workflowApi.getWorkflow(execution.workflowId);
      if (!workflow || workflow.status !== 'PUBLISHED') {
        setNotice(isVietnamese ? 'Chỉ có thể chạy lại quy trình đã xuất bản.' : tr('msg.only_published_workflows_can_be_run_again'));
        return;
      }
      const receipt = await workflowApi.runWorkflow(execution.workflowId);
      setNotice(isVietnamese
        ? `Đã đưa lượt chạy ${receipt.executionId} vào hàng đợi.`
        : `Execution ${receipt.executionId} was queued.`);
      await refresh(true);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const openDetail = (execution: ExecutionDetail) => {
    navigate(`/executions/${encodeURIComponent(execution.id)}?workflowId=${encodeURIComponent(execution.workflowId)}`);
  };

  const fieldCls =
    'h-8 rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
  const btnCls =
    'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
  const th = 'h-8 whitespace-nowrap border-b border-border bg-subtle px-3 text-left text-xs font-medium text-muted-foreground';
  const td = 'h-10 whitespace-nowrap border-b border-border px-3';
  const failedCount = executions.filter((execution) => execution.status === 'FAILED').length;

  return (
    <main className="-m-4 flex h-[calc(100%+2rem)] min-h-0 flex-col bg-card sm:-m-5 sm:h-[calc(100%+2.5rem)]">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-2">
        <h1 className="text-base font-semibold text-foreground">{t('executions.title')}</h1>
        {!loading && (
          <span className="tabular-nums text-muted-foreground">
            {executions.length} {isVietnamese ? 'lượt' : 'runs'}
            {failedCount > 0 && <span className="text-err"> · {failedCount} {isVietnamese ? 'lỗi' : 'failed'}</span>}
          </span>
        )}
        <button type="button" onClick={() => void refresh(true)} disabled={refreshing || loading} className={`${btnCls} ml-auto`}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          {isVietnamese ? 'Làm mới' : 'Refresh'}
        </button>
      </header>

      {notice && <p role="status" className="shrink-0 border-b border-border bg-accent px-5 py-2 text-[13px] text-accent-foreground">{notice}</p>}
      {error && (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-err-border bg-err-bg px-5 py-2 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">{error}</div>
          <button type="button" className="font-medium underline" onClick={() => void refresh()}>{isVietnamese ? 'Thử lại' : 'Retry'}</button>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
        <label className="relative flex w-full items-center sm:w-[280px]">
          <span className="sr-only">{t('executions.search')}</span>
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('executions.search')} className={`${fieldCls} w-full pl-[30px]`} />
        </label>
        {!workflowId && (
          <select aria-label={t('executions.col_workflow')} value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} className={fieldCls}>
            <option value="ALL">{isVietnamese ? 'Tất cả quy trình' : 'All workflows'}</option>
            {workflows.map((workflow) => <option key={workflow.id} value={workflow.name}>{workflow.name}</option>)}
          </select>
        )}
        <label className="sr-only" htmlFor="execution-status-filter">{t('executions.col_status')}</label>
        <select id="execution-status-filter" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className={fieldCls}>
          <option value="ALL">{isVietnamese ? 'Mọi trạng thái' : 'All statuses'}</option>
          {(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const).map((value) => <option key={value} value={value}>{statusLabel(value, isVietnamese)}</option>)}
        </select>
        {!workflowId && (
          <span className="ml-auto text-xs text-muted-foreground">
            {isVietnamese
              ? 'Tối đa 100 lượt mới nhất cho mỗi workflow.'
              : tr('msg.up_to_the_100_latest_runs_per')}
          </span>
        )}
        <span className={`${workflowId ? 'ml-auto ' : ''}inline-flex items-center gap-1.5 text-xs text-muted-foreground`}>
          <Clock3 size={13} aria-hidden="true" />
          {t('runs.auto_refresh')}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>{t('executions.col_status')}</th>
              <th className={th}>{t('executions.col_id')}</th>
              <th className={th}>{t('executions.col_workflow')}</th>
              <th className={th}>{isVietnamese ? 'Kích hoạt' : 'Trigger'}</th>
              <th className={th}>{t('executions.col_started')}</th>
              <th className={`${th} text-right`}>{t('executions.col_duration')}</th>
              <th className={`${th} text-right`}>{t('executions.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((execution) => (
              <tr key={execution.id} className="transition-colors hover:bg-subtle">
                <td className={td}><span className={statusBadgeClass(statusTone(execution.status))}>{statusLabel(execution.status, isVietnamese)}</span></td>
                <td className={`${td} font-mono text-xs text-text-2`}>{execution.id}</td>
                <td className={`${td} max-w-[280px] overflow-hidden text-ellipsis font-medium text-foreground`} title={execution.workflowName}>{execution.workflowName}</td>
                <td className={`${td} text-text-2`}>{triggerTypeLabel(execution.triggerType, t)}</td>
                <td className={`${td} tabular-nums text-text-2`}>{formatDate(execution.startedAt)}</td>
                <td className={`${td} text-right font-mono text-xs tabular-nums text-text-2`}>{duration(execution)}</td>
                <td className={`${td} text-right`}>
                  <div className="inline-flex gap-1.5">
                    <button type="button" onClick={() => openDetail(execution)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-text-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ExternalLink size={13} aria-hidden="true" />{t('executions.view_trace')}
                    </button>
                    <button type="button" onClick={() => void rerun(execution)} disabled={execution.status === 'QUEUED' || execution.status === 'RUNNING'} title={isVietnamese ? 'Đưa một lượt chạy mới vào hàng đợi' : 'Queue a new run'} className="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong px-2 text-xs font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40">
                      <Play size={12} aria-hidden="true" />{isVietnamese ? 'Chạy lại' : 'Run again'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-[13px] text-text-2">{isVietnamese ? 'Không có lượt chạy phù hợp.' : tr('msg.no_matching_executions')}</td></tr>
            )}
          </tbody>
        </table>
        {loading && <div role="status" className="flex justify-center py-12"><LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={isVietnamese ? 'Đang tải' : 'Loading'} /></div>}
      </div>
    </main>
  );
}

export function LiveWorkflowExecutionsPage() {
  const params = useParams<{ workflowId: string }>();
  const [search] = useSearchParams();
  const workflowId = params.workflowId ?? search.get('workflowId');
  if (!workflowId) return <LiveGlobalExecutionsPage />;
  return (
    <ExecutionsTriPane
      key={workflowId}
      workflowId={workflowId}
      selectedExecutionId={search.get('run') ?? search.get('executionId')}
    />
  );
}
