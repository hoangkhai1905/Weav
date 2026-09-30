import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Clock3, ExternalLink, LoaderCircle, Play, RefreshCw, Search } from 'lucide-react';
import { executionApi } from '../api/execution.api';
import { isWorkflowMockMode, workflowApi } from '../api/workflow.api';
import type { ExecutionDetail, WorkflowDefinition } from '../types/workflow.types';
import { useI18nStore } from '../store/useI18nStore';

type StatusFilter = 'ALL' | ExecutionDetail['status'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Workflow service is temporarily unavailable.';
}

function statusLabel(status: ExecutionDetail['status'], isVietnamese: boolean): string {
  const labels = isVietnamese
    ? { QUEUED: 'Đang chờ', RUNNING: 'Đang chạy', SUCCESS: 'Thành công', FAILED: 'Thất bại', CANCELLED: 'Đã hủy' }
    : { QUEUED: 'Queued', RUNNING: 'Running', SUCCESS: 'Success', FAILED: 'Failed', CANCELLED: 'Cancelled' };
  return labels[status];
}

function statusClass(status: ExecutionDetail['status']): string {
  if (status === 'SUCCESS') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300';
  if (status === 'FAILED') return 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300';
  if (status === 'RUNNING' || status === 'QUEUED') return 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
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

export function LiveWorkflowExecutionsPage() {
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

  const refresh = useCallback(async (silent = false) => {
    if (isWorkflowMockMode) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [items, workflowItems] = await Promise.all([
        executionApi.getExecutions(workflowId),
        workflowApi.getWorkflows(),
      ]);
      setExecutions(items);
      setWorkflows(workflowItems);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workflowId) return;
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [refresh, workflowId]);

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
        setNotice(isVietnamese ? 'Chỉ có thể chạy lại workflow đang Published.' : 'Only published workflows can be run again.');
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

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('executions.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('executions.subtitle')}</p>
          {!workflowId && (
            <p className="mt-1 text-xs text-slate-400">
              {isVietnamese
                ? 'Hiển thị tối đa 100 lượt chạy mới nhất cho mỗi workflow; API V1 chưa có danh sách execution toàn cục.'
                : 'Showing up to 100 latest runs per workflow; API V1 has no global execution-list endpoint.'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          {isVietnamese ? 'Làm mới' : 'Refresh'}
        </button>
      </header>

      {notice && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">{notice}</p>}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">{error}</div>
          <button type="button" className="underline" onClick={() => void refresh()}>{isVietnamese ? 'Thử lại' : 'Retry'}</button>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <Search size={15} className="text-slate-400" />
            <input aria-label={t('executions.search')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('executions.search')} className="w-full bg-transparent text-sm outline-none" />
          </label>
          {!workflowId && (
            <select aria-label={t('executions.col_workflow')} value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} className="rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700">
              <option value="ALL">{isVietnamese ? 'Tất cả workflow' : 'All workflows'}</option>
              {workflows.map((workflow) => <option key={workflow.id} value={workflow.name}>{workflow.name}</option>)}
            </select>
          )}
          <label className="sr-only" htmlFor="execution-status-filter">{t('executions.col_status')}</label>
          <select id="execution-status-filter" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700">
            <option value="ALL">{isVietnamese ? 'Mọi trạng thái' : 'All statuses'}</option>
            {(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const).map((value) => <option key={value} value={value}>{statusLabel(value, isVietnamese)}</option>)}
          </select>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-3 py-2 font-medium">{t('executions.col_id')}</th>
                <th className="px-3 py-2 font-medium">{t('executions.col_workflow')}</th>
                <th className="px-3 py-2 font-medium">{t('executions.col_status')}</th>
                <th className="px-3 py-2 font-medium">{t('executions.col_started')}</th>
                <th className="px-3 py-2 font-medium">{t('executions.col_duration')}</th>
                <th className="px-3 py-2 font-medium">{isVietnamese ? 'Kích hoạt' : 'Trigger'}</th>
                <th className="px-3 py-2 text-right font-medium">{t('executions.col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((execution) => (
                <tr key={execution.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-3 font-mono text-xs">{execution.id}</td>
                  <td className="px-3 py-3 font-medium text-slate-800 dark:text-slate-100">{execution.workflowName}</td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(execution.status)}`}>{statusLabel(execution.status, isVietnamese)}</span></td>
                  <td className="px-3 py-3 text-xs text-slate-500">{formatDate(execution.startedAt)}</td>
                  <td className="px-3 py-3 font-mono text-xs">{duration(execution)}</td>
                  <td className="px-3 py-3 text-xs text-slate-500">{execution.triggerType}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button type="button" onClick={() => openDetail(execution)} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs dark:bg-slate-800">
                        <ExternalLink size={13} />{t('executions.view_trace')}
                      </button>
                      <button type="button" onClick={() => void rerun(execution)} disabled={execution.status === 'QUEUED' || execution.status === 'RUNNING'} title={isVietnamese ? 'Đưa một lượt chạy mới vào hàng đợi' : 'Queue a new run'} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700">
                        <Play size={13} />{isVietnamese ? 'Chạy lại' : 'Run again'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-12 text-center text-sm text-slate-500">{isVietnamese ? 'Không có lượt chạy phù hợp.' : 'No matching executions.'}</td></tr>
              )}
            </tbody>
          </table>
          {loading && <div className="flex justify-center py-12"><LoaderCircle size={22} className="animate-spin text-blue-600" /></div>}
        </div>
        {workflowId && <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><Clock3 size={13} />{isVietnamese ? 'Tự làm mới mỗi 5 giây khi lọc theo workflow.' : 'Auto-refreshes every 5 seconds for a workflow-filtered view.'}</p>}
      </section>
    </main>
  );
}
